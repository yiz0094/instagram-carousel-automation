const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';

export async function createMediaContainer(igUserId, imageUrl, accessToken) {
  const url = `${GRAPH_API_BASE}/${igUserId}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: accessToken
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Container creation failed: ${JSON.stringify(data.error)}`);
  console.log(`[Instagram] Created media container: ${data.id}`);
  return data.id;
}

export async function createCarouselContainer(igUserId, childrenIds, caption, accessToken) {
  const url = `${GRAPH_API_BASE}/${igUserId}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'CAROUSEL',
      children: childrenIds,
      caption: caption,
      access_token: accessToken
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Carousel container failed: ${JSON.stringify(data.error)}`);
  console.log(`[Instagram] Created carousel container: ${data.id}`);
  return data.id;
}

export async function checkContainerStatus(containerId, accessToken) {
  const url = `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.status_code; // FINISHED, IN_PROGRESS, ERROR
}

export async function waitForContainer(containerId, accessToken, maxRetries = 30, intervalMs = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    const status = await checkContainerStatus(containerId, accessToken);
    if (status === 'FINISHED') return true;
    if (status === 'ERROR') throw new Error(`Container ${containerId} has ERROR status`);
    console.log(`[Instagram] Container ${containerId} status: ${status}, waiting...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Container ${containerId} timed out after ${maxRetries * intervalMs / 1000}s`);
}

export async function publishMedia(igUserId, containerId, accessToken) {
  const url = `${GRAPH_API_BASE}/${igUserId}/media_publish`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Publish failed: ${JSON.stringify(data.error)}`);
  console.log(`[Instagram] Published! Media ID: ${data.id}`);
  return data.id;
}

export async function getMediaInsights(mediaId, accessToken) {
  // v22.0: impressions deprecated → reach, saved, likes, comments, shares, total_interactions 사용
  const url = `${GRAPH_API_BASE}/${mediaId}/insights?metric=reach,saved,likes,comments,shares,total_interactions&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Insights failed: ${JSON.stringify(data.error)}`);

  const metrics = {};
  if (data.data) {
    for (const item of data.data) {
      metrics[item.name] = item.values?.[0]?.value ?? 0;
    }
  }
  return metrics;
}
