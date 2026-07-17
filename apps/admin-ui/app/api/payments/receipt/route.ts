import { NextResponse, type NextRequest } from 'next/server';
import axios from 'axios';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
    }

    if (!token) {
      return NextResponse.json({ error: 'Telegram Bot Token not configured' }, { status: 500 });
    }

    // 1. Get file path from Telegram API
    const fileInfoUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
    const fileInfoRes = await axios.get(fileInfoUrl);
    const filePath = fileInfoRes.data?.result?.file_path;

    if (!filePath) {
      return NextResponse.json({ error: 'Failed to retrieve file path from Telegram' }, { status: 404 });
    }

    // 2. Download the actual image
    const fileDownloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const imageRes = await axios.get(fileDownloadUrl, { responseType: 'arraybuffer' });

    // 3. Return the image as response with correct content-type
    const contentType = imageRes.headers['content-type'] || 'image/jpeg';
    return new Response(imageRes.data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
