import { exec } from "child_process";

console.log("Checking if yt-dlp is installed and getting version...");

exec("yt-dlp --version", (error, stdout, stderr) => {
  if (error) {
    console.error("Error running yt-dlp:", error.message);
    console.error("Stderr:", stderr);
    return;
  }
  console.log("yt-dlp version:", stdout.trim());
  
  // Now let's try to get the subtitle URLs using yt-dlp!
  // yt-dlp has a built-in option to extract subtitle URLs or download subtitles:
  // yt-dlp --write-subs --write-auto-subs --skip-download --print-subs
  console.log("\nAttempting to fetch subtitle list with yt-dlp...");
  exec("yt-dlp --list-subs https://www.youtube.com/watch?v=1X3MQFsGCd4", (err, so, se) => {
    if (err) {
      console.error("Error listing subtitles with yt-dlp:", err.message);
      console.error("Stderr:", se);
    } else {
      console.log("yt-dlp Subtitle list output:\n", so);
    }
  });
});
