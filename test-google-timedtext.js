const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function run() {
  const videoId = "1X3MQFsGCd4"; // TED talk
  const urls = [
    `https://video.google.com/timedtext?hl=en&v=${videoId}`,
    `https://video.google.com/timedtext?type=list&v=${videoId}`
  ];

  for (const url of urls) {
    console.log("\nTesting legacy API:", url);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });
      console.log("Status:", res.status);
      const text = await res.text();
      console.log("Length received:", text.length);
      console.log("Starts with:", text.substring(0, 300));
    } catch (e) {
      console.error("Error:", e.message);
    }
  }
}

run();
