const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function run() {
  const videoId = "1X3MQFsGCd4";
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://thingproxy.freeboard.io/fetch/${targetUrl}`,
    `https://cors-anywhere.herokuapp.com/${targetUrl}`,
    `https://proxy.cors.sh/${targetUrl}`
  ];

  for (const proxy of proxies) {
    console.log("\nTesting proxy:", proxy);
    try {
      const response = await fetch(proxy, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        },
        timeout: 8000
      });
      console.log("Status:", response.status);
      const html = await response.text();
      console.log("HTML length received:", html.length);
      const hasCaptionTracks = html.includes("captionTracks");
      console.log("Contains 'captionTracks':", hasCaptionTracks);
      if (hasCaptionTracks) {
        console.log("SUCCESS!");
        return;
      }
    } catch (err) {
      console.error("Error:", err.message);
    }
  }
}

run();
