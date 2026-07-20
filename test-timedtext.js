const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function run() {
  const videoId = "1X3MQFsGCd4"; // TED talk video ID
  const urls = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=vi&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=vi`
  ];

  for (const url of urls) {
    console.log("\nTesting API:", url);
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
