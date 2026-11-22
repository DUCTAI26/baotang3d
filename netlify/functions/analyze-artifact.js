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
    const mode = payload.mode === 'room' ? 'room' : 'artifact';

    // Hỗ trợ 1 ảnh (imageBase64) hoặc nhiều ảnh (images: [{ base64, mimeType }])
    const imageList = [];
    if (Array.isArray(payload.images) && payload.images.length > 0) {
      for (const img of payload.images.slice(0, 3)) {
        if (img && typeof img.base64 === 'string' && img.base64.length > 0) {
          imageList.push({
            base64: img.base64,
            mimeType: img.mimeType || 'image/jpeg'
          });
        }
      }
    } else if (typeof payload.imageBase64 === 'string' && payload.imageBase64.length > 0) {
      imageList.push({
        base64: payload.imageBase64,
        mimeType: payload.mimeType || 'image/jpeg'
      });
    }

    if (imageList.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'INVALID_INPUT', message: 'Thiếu dữ liệu ảnh đầu vào.' })
      };
    }

    const totalSize = imageList.reduce((sum, img) => sum + img.base64.length, 0);
    if (totalSize > 6 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers,
        body: JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: 'Tổng dung lượng ảnh quá lớn, vui lòng chọn ảnh nhẹ hơn.' })
      };
    }

    let prompt = '';
    if (mode === 'room') {
      const hintWidth = Number(payload.hintWidth) || 0;
      const hintDepth = Number(payload.hintDepth) || 0;
      const sizeHint = (hintWidth > 0 && hintDepth > 0)
        ? `Kích thước thực tế người dùng ước lượng: ngang khoảng ${hintWidth}m, sâu khoảng ${hintDepth}m.`
        : 'Hãy tự ước lượng kích thước thực tế hợp lý theo mét (ví dụ phòng nhỏ 4-8m, phòng trưng bày bảo tàng 8-20m).';

      prompt = `Bạn là kiến trúc sư AI chuyên phân tích ảnh sơ đồ mặt bằng hoặc ảnh chụp không gian phòng bảo tàng để dựng mô hình 3D tường liền mạch.
${sizeHint}
Hãy phân tích hình dáng tổng thể của căn phòng (chữ nhật, chữ L, chữ U, hành lang, đa giác...) và trả về danh sách các ĐỈNH GÓC TƯỜNG theo thứ tự nối tiếp nhau thành một đa giác khép kín (theo chiều kim đồng hồ), tọa độ tính bằng mét với tâm phòng ở (0, 0).
Ưu tiên các góc vuông 90° sạch sẽ nếu là phòng thông thường. Đồng thời xác định vị trí cửa ra vào và tủ trưng bày/bệ hiện vật nếu nhìn thấy rõ.

Trả về DUY NHẤT một chuỗi JSON hợp lệ (không bọc markdown) theo đúng cấu trúc:
{
  "roomName": "Tên gợi ý cho khu vực/phòng bằng tiếng Việt",
  "description": "Mô tả ngắn 1-2 câu về hình dáng và bố cục phòng",
  "wallHeight": 3.2,
  "vertices": [
    { "x": -4.0, "z": -3.0 },
    { "x": 4.0, "z": -3.0 },
    { "x": 4.0, "z": 3.0 },
    { "x": -4.0, "z": 3.0 }
  ],
  "doors": [
    { "wallIndex": 0, "offsetRatio": 0.5, "width": 1.4 }
  ],
  "displayCases": [
    { "name": "Tủ trưng bày 1", "x": 0.0, "z": 0.0, "width": 1.2, "depth": 0.8, "height": 1.5 }
  ]
}`;
    } else {
      prompt = `Bạn là hệ thống thị giác máy tính nhận diện vật thể trong bảo tàng và đời sống.
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
    }

    const parts = [{ text: prompt }];
    for (const img of imageList) {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
    }

    const requestBody = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    });

    const attempts = [
      { model: 'gemini-flash-lite-latest' },
      { model: 'gemini-flash-latest' }
    ];

    let response = null;
    let lastStatus = 500;
    let lastErrText = '';

    for (const attempt of attempts) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        response = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey
          },
          signal: controller.signal,
          body: requestBody
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.ok) break;

      lastStatus = response.status;
      lastErrText = await response.text();

      if (lastStatus !== 503 && lastStatus !== 404) {
        break;
      }
    }

    if (!response || !response.ok) {
      return {
        statusCode: lastStatus === 404 ? 502 : lastStatus,
        headers,
        body: JSON.stringify({
          error: `UPSTREAM_HTTP_${lastStatus}`,
          message: lastErrText.slice(0, 300)
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

    if (mode === 'room') {
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const rawVertices = Array.isArray(parsed.vertices) ? parsed.vertices : [];
      const vertices = rawVertices
        .map((v) => ({
          x: Number(v?.x),
          z: Number(v?.z)
        }))
        .filter((v) => Number.isFinite(v.x) && Number.isFinite(v.z))
        .map((v) => ({
          x: Math.round(clamp(v.x, -40, 40) * 100) / 100,
          z: Math.round(clamp(v.z, -40, 40) * 100) / 100
        }));

      if (vertices.length < 3) {
        return {
          statusCode: 422,
          headers,
          body: JSON.stringify({
            error: 'INVALID_ROOM_GEOMETRY',
            message: 'AI chưa xác định đủ góc tường từ ảnh này. Hãy thử ảnh rõ toàn cảnh hoặc ảnh sơ đồ hơn.'
          })
        };
      }

      const wallHeight = clamp(Number(parsed.wallHeight) || 3.2, 2.0, 8.0);
      const doors = Array.isArray(parsed.doors)
        ? parsed.doors
            .map((d) => ({
              wallIndex: Math.floor(Number(d?.wallIndex) || 0),
              offsetRatio: clamp(Number(d?.offsetRatio) || 0.5, 0.15, 0.85),
              width: clamp(Number(d?.width) || 1.4, 0.7, 4.0)
            }))
            .filter((d) => d.wallIndex >= 0 && d.wallIndex < vertices.length)
        : [];

      // Tự động nối khép kín tất cả các đỉnh thành các đoạn tường liền mạch
      const walls = [];
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 0.2) continue;

        const doorOnWall = doors.find((d) => d.wallIndex === i) || null;
        walls.push({
          x1: a.x,
          z1: a.z,
          x2: b.x,
          z2: b.z,
          length: Math.round(length * 100) / 100,
          height: wallHeight,
          door: doorOnWall
        });
      }

      const displayCases = Array.isArray(parsed.displayCases)
        ? parsed.displayCases
            .map((c) => ({
              name: typeof c?.name === 'string' ? c.name.trim() : 'Tủ trưng bày',
              x: Math.round(clamp(Number(c?.x) || 0, -35, 35) * 100) / 100,
              z: Math.round(clamp(Number(c?.z) || 0, -35, 35) * 100) / 100,
              width: clamp(Number(c?.width) || 1.0, 0.3, 6.0),
              depth: clamp(Number(c?.depth) || 0.7, 0.3, 6.0),
              height: clamp(Number(c?.height) || 1.4, 0.5, 3.0)
            }))
            .slice(0, 20)
        : [];

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          mode: 'room',
          roomName: typeof parsed.roomName === 'string' && parsed.roomName.trim() ? parsed.roomName.trim() : 'Phòng trưng bày AI',
          description: parsed.description || '',
          wallHeight,
          vertices,
          walls,
          doors,
          displayCases
        })
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
