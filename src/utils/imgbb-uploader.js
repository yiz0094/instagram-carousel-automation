import { readFile } from 'fs/promises';

const IMGBB_API_URL = 'https://api.imgbb.com/1/upload';

export async function uploadImage(localFilePath, apiKey) {
  const imageBuffer = await readFile(localFilePath);
  const base64Image = imageBuffer.toString('base64');

  const formData = new URLSearchParams();
  formData.append('key', apiKey);
  formData.append('image', base64Image);

  const res = await fetch(IMGBB_API_URL, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`imgbb upload failed for ${localFilePath}: ${error}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`imgbb upload failed: ${JSON.stringify(data)}`);
  }

  console.log(`[imgbb] Uploaded: ${localFilePath} → ${data.data.url}`);
  return data.data.url;
}

export async function uploadAllImages(imagePaths, apiKey) {
  const urls = [];
  for (const imagePath of imagePaths) {
    const url = await uploadImage(imagePath, apiKey);
    urls.push(url);
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  return urls;
}
