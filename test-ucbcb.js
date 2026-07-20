const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function run() {
  const videoId = "1X3MQFsGCd4";
  const urls = [
    `https://www.youtube.com/watch?v=${videoId}&ucbcb=1`,
    `https://m.youtube.com/watch?v=${videoId}&ucbcb=1`,
    `https://www.youtube.com/watch?v=${videoId}&ucbcb=1&hl=vi&gl=VN`,
    `https://www.youtube.com/watch?v=${videoId}&pbj=1`
  ];

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+407; SOCS=CAESEwgDEgk0ODE3NTEzNDQaAnZpIAEaBgiA_K6nBg"
  };

  for (const url of urls) {
    console.log("\nTesting:", url);
    try {
      const response = await fetch(url, { headers });
      console.log("Status:", response.status);
      const html = await response.text();
      console.log("HTML length received:", html.length);
      
      const hasCaptionTracks = html.includes("captionTracks");
      console.log("Contains 'captionTracks':", hasCaptionTracks);
      
      if (hasCaptionTracks) {
        const match = html.match(/"captionTracks":\s*(\[.*?\])/);
        if (match) {
          console.log("SUCCESS! Parsed captionTracks!");
          console.log(match[1].substring(0, 300));
        }
      } else {
        console.log("Title of page parsed:", html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
        console.log("Contains robot/consent:", html.toLowerCase().includes("consent") || html.toLowerCase().includes("robot") || html.toLowerCase().includes("captcha"));
      }
    } catch (err) {
      console.error("Error:", err.message);
    }
  }
}

run();
