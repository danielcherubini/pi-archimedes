import { safeFetch } from '../network/fetch.js';
import { extractReadable } from './readable.js';
import type { ExtractedDoc } from './types.js';

export async function extractYouTube(url: string): Promise<ExtractedDoc> {
  const parsedUrl = new URL(url);
  const videoId = parsedUrl.hostname === 'youtu.be' 
    ? parsedUrl.pathname.slice(1).split('/')[0]
    : parsedUrl.searchParams.get('v');

  if (!videoId) {
    const text = await (await safeFetch(url)).text();
    return await extractReadable(text, url, 200);
  }

  const watchPage = await (await safeFetch(url)).text();
  const playerResponseMatch = watchPage.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);

  if (playerResponseMatch && playerResponseMatch[1]) {
    const playerResponse = JSON.parse(playerResponseMatch[1]);
    const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks as Array<any> | undefined;

    if (captionTracks && captionTracks.length > 0) {
      const track = captionTracks[0];
      const baseUrl = track.baseUrl as string;
      const captionResponse = await safeFetch(baseUrl as string);
      const xml = await captionResponse.text();
      const transcript = xml.replace(/<text[^>]*>/g, '').replace(/<\/text>/g, '\n').replace(/&amp;/g, '&');
      
      return {
        title: playerResponse.videoDetails.title,
        url,
        markdown: `## ${playerResponse.videoDetails.title}\n\n${transcript}`,
        wordCount: transcript.split(/\s+/).length,
        status: 200,
        extractor: 'youtube',
      };
    }
  }

  const response = await safeFetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
  
  if (!response.ok) {
    return await extractReadable(watchPage, url, response.status);
  }

  const data = await response.json();
  const text = `${data.title} ${data.author_name}`;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  
  return {
    title: data.title,
    url,
    markdown: `Video: ${data.title}\n\n[Watch on YouTube](${url})`,
    wordCount,
    status: response.status,
    extractor: 'youtube',
  };
}
