import { Innertube } from "youtubei.js";

async function run() {
  const videoId = "1X3MQFsGCd4"; // TED Talk
  try {
    console.log("Initializing Innertube...");
    const youtube = await Innertube.create();
    console.log("Fetching video info for videoId:", videoId);
    const info = await youtube.getInfo(videoId);
    
    console.log("Title:", info.basic_info.title);
    console.log("Author:", info.basic_info.author);

    console.log("Attempting to get transcript...");
    const transcriptInfo = await info.getTranscript();
    console.log("Transcript fetched successfully!");
    
    // Check structure of transcriptInfo
    console.log("transcriptInfo keys:", Object.keys(transcriptInfo));
    
    // Check transcriptInfo.transcript or content
    if (transcriptInfo.transcript) {
      console.log("transcript keys:", Object.keys(transcriptInfo.transcript));
      const content = transcriptInfo.transcript.content;
      if (content) {
        console.log("content keys:", Object.keys(content));
        if (content.body && content.body.initial_segments) {
          const segments = content.body.initial_segments;
          console.log(`Found ${segments.length} segments!`);
          console.log("First 3 segments details:");
          for (let i = 0; i < Math.min(3, segments.length); i++) {
            console.log(JSON.stringify(segments[i], null, 2));
          }
        }
      }
    } else {
      // Maybe it has another structure? Let's stringify first 500 chars of the transcriptInfo
      console.log("Stringified transcriptInfo (first 1000 chars):", JSON.stringify(transcriptInfo).substring(0, 1000));
    }
  } catch (err) {
    console.error("Innertube error:", err);
  }
}

run();
