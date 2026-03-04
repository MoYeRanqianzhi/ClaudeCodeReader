//! # HTTPS 转发器
//!
//! 使用 reqwest 将代理收到的 HTTP 请求通过 HTTPS 转发到上游 API。
//! 支持 SSE 流式响应的逐 chunk 转发和完整内容缓冲。

use std::collections::HashMap;

use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::Client;

/// 转发结果
pub struct ForwardResult {
    /// HTTP 响应状态码
    pub status: u16,
    /// 响应 headers
    pub headers: HashMap<String, String>,
    /// 响应 body（完整内容）
    pub body: String,
}

/// 将请求转发到上游 API
///
/// 将收到的 HTTP 请求通过 HTTPS 转发到上游 Anthropic API。
/// 对于 SSE 流式响应，会缓冲所有 chunk 拼接为完整 body。
///
/// # 参数
/// - `client` - reqwest HTTP 客户端（复用连接池）
/// - `upstream_url` - 上游 API 基础 URL（如 https://api.anthropic.com）
/// - `method` - HTTP 方法
/// - `path` - 请求路径（如 /v1/messages）
/// - `headers` - 请求 headers
/// - `body` - 请求 body（可选）
pub async fn forward_request(
    client: &Client,
    upstream_url: &str,
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: Option<&str>,
) -> Result<ForwardResult, String> {
    // 构建上游 URL
    let full_url = format!("{}{}", upstream_url.trim_end_matches('/'), path);

    // 构建 reqwest 请求
    let req_method = method
        .parse::<reqwest::Method>()
        .map_err(|e| format!("无效的 HTTP 方法: {}", e))?;

    let mut req_builder = client.request(req_method, &full_url);

    // 设置 headers
    for (key, value) in headers {
        // 跳过 host header（reqwest 会自动设置）
        if key.to_lowercase() == "host" {
            continue;
        }
        req_builder = req_builder.header(key, value);
    }

    // 设置 body
    if let Some(body) = body {
        req_builder = req_builder.body(body.to_string());
    }

    // 发送请求
    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("转发请求失败: {}", e))?;

    // 收集响应信息
    let status = response.status().as_u16();
    let resp_headers: HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    // 判断是否为 SSE 流式响应
    let content_type = resp_headers
        .get("content-type")
        .map(|s| s.as_str())
        .unwrap_or("");

    let is_sse = content_type.contains("text/event-stream");

    // 读取响应 body
    let body = if is_sse {
        // SSE 流式响应：逐 chunk 读取并拼接
        let mut body_buf = String::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                        body_buf.push_str(&text);
                    }
                }
                Err(e) => {
                    log::warn!("读取 SSE chunk 失败: {}", e);
                    break;
                }
            }
        }
        body_buf
    } else {
        // 非流式响应：一次性读取
        response
            .text()
            .await
            .map_err(|e| format!("读取响应 body 失败: {}", e))?
    };

    Ok(ForwardResult {
        status,
        headers: resp_headers,
        body,
    })
}

/// 构建转发响应的 HTTP 响应（返回给 Claude Code CLI）
///
/// 将上游 API 的响应转换为 hyper 可返回的 HTTP 响应。
pub fn build_response(
    status: u16,
    headers: &HashMap<String, String>,
    body: &str,
) -> Result<hyper::Response<http_body_util::Full<Bytes>>, String> {
    let mut builder = hyper::Response::builder().status(status);

    for (key, value) in headers {
        // 跳过 transfer-encoding（hyper 会自动处理）
        if key.to_lowercase() == "transfer-encoding" {
            continue;
        }
        builder = builder.header(key, value);
    }

    builder
        .body(http_body_util::Full::new(Bytes::from(body.to_string())))
        .map_err(|e| format!("构建响应失败: {}", e))
}

/// 构建错误响应
pub fn build_error_response(
    status: u16,
    message: &str,
) -> hyper::Response<http_body_util::Full<Bytes>> {
    let body = serde_json::json!({
        "error": {
            "message": message,
            "type": "proxy_error"
        }
    });

    hyper::Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(http_body_util::Full::new(Bytes::from(body.to_string())))
        .unwrap_or_else(|_| {
            hyper::Response::new(http_body_util::Full::new(Bytes::from("Internal Error")))
        })
}
