const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function run() {
  const videoId = "dQw4w9WgXcQ"; // Rick Astley - standard non-age-restricted video
  const apiKey = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const url = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
  
  const payload = {
    videoId: videoId,
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20230622.01.00",
        hl: "vi",
        gl: "VN"
      }
    }
  };
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      },
      body: JSON.stringify(payload)
    });
    
    console.log("Status:", response.status);
    const data = await response.json();
    console.log("Playability Status for dQw4w9WgXcQ:", data.playabilityStatus?.status);
    console.log("Has Captions:", !!data.captions);
    if (data.captions) {
      const captionTracks = data.captions.playerCaptionsTracklistRenderer?.captionTracks;
      console.log("Tracks count:", captionTracks?.length);
    }
  } catch (err) {
    console.error(err);
  }
}

run();
