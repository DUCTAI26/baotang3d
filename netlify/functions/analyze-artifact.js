// netlify/functions/analyze-artifact.js
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'MISSING_API_KEY',
        message: 'Chưa cấu hình biến môi trường GEMINI_API_KEY trên Netlify.'
      })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const imageBase64 = payload.imageBase64;
    const mimeType = payload.mimeType || 'image/jpeg';

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'INVALID_INPUT', message: 'Thiếu dữ liệu ảnh đầu vào.' })
      };
    }

    // Giới hạn kích thước ảnh ~4.5MB base64 để tránh quá tải Netlify Function
    if (imageBase64.length > 6 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers,
        body: JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: 'Ảnh quá lớn, vui lòng chụp lại.' })
      };
    }

    const prompt = `Bạn là hệ thống thị giác máy tính nhận diện vật thể trong bảo tàng và đời sống.
Hãy phân tích vật thể chính ở trung tâm bức ảnh. Nhận diện cả vật dụng phổ thông (cốc uống nước, ly, chai nước, bình, bát, đĩa, hộp, bàn, ghế, tranh, ảnh, đồ gốm, đồ đồng, đồ trang trí) lẫn hiện vật lịch sử/khảo cổ.
Không tự bịa tên nếu ảnh quá mờ hoặc không thấy rõ vật thể.

Trả về DUY NHẤT một chuỗi JSON hợp lệ (không bọc markdown) theo đúng cấu trúc:
{
  "name": "Tên vật thể bằng tiếng Việt (hoặc chuỗi rỗng nếu không thể nhận diện)",
  "category": "Vật dụng phổ thông | Đồ gốm | Đồ đồng | Tranh ảnh | Nội thất | Hiện vật lịch sử | Khác",
  "shortDescription": "Mô tả ngắn gọn 1-2 câu về vật thể",
  "confidence": 0.0,
  "displayCase": {
    "detected": false,
    "needsConfirmation": false,
    "reason": "Lý do nhận định có/không có tủ kính (phân biệt rõ với khung tranh, cửa kính, mặt phản chiếu)",
    "width": 0.8,
    "height": 1.2,
    "depth": 0.6
  }
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      return {
        statusCode: response.status === 404 ? 502 : response.status,
        headers,
        body: JSON.stringify({
          error: `UPSTREAM_HTTP_${response.status}`,
          message: errText.slice(0, 300)
        })
      };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'INVALID_AI_JSON', message: 'AI trả về JSON không hợp lệ.' })
      };
    }

    const result = {
      name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
      category: parsed.category || 'Khác',
      shortDescription: parsed.shortDescription || '',
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      displayCase: {
        detected: Boolean(parsed.displayCase?.detected),
        needsConfirmation: Boolean(parsed.displayCase?.needsConfirmation),
        reason: parsed.displayCase?.reason || '',
        width: Number(parsed.displayCase?.width) || 0.8,
        height: Number(parsed.displayCase?.height) || 1.2,
        depth: Number(parsed.displayCase?.depth) || 0.6
      }
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return {
      statusCode: isTimeout ? 504 : 500,
      headers,
      body: JSON.stringify({
        error: isTimeout ? 'TIMEOUT' : 'SERVER_ERROR',
        message: err.message || 'Lỗi xử lý trên máy chủ.'
      })
    };
  }
};
