import ytdl from "@distube/ytdl-core";

async function run() {
  const videoId = "1X3MQFsGCd4"; // TED Talk
  try {
    console.log("Fetching basic info via @distube/ytdl-core...");
    const info = await ytdl.getBasicInfo(videoId);
    console.log("Title:", info.videoDetails.title);
    console.log("Author:", info.videoDetails.author?.name);
    
    const playerResponse = info.player_response;
    if (playerResponse && playerResponse.captions) {
      const captions = playerResponse.captions.playerCaptionsTracklistRenderer;
      if (captions && captions.captionTracks) {
        console.log("SUCCESS! Found captionTracks via @distube/ytdl-core!");
        console.log("Tracks available:", captions.captionTracks.length);
        for (const track of captions.captionTracks) {
          console.log(`- Language: ${track.languageCode} (${track.name.simpleText}), Base URL: ${track.baseUrl.substring(0, 100)}...`);
        }
      } else {
        console.log("No captionTracks in playerCaptionsTracklistRenderer");
      }
    } else {
      console.log("No captions in player_response");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
