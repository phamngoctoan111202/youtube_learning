const userRawText = `(0:00 - 0:03): Mr. Mrs. Smith, thank you for taking time off work to come in.
(0:03 - 0:05): So, what's this about, Principal Vagina?
(0:05 - 0:11): Yeah, what is this about? You're not a leaner. You don't have that in you. Go sit at your desk like the outer city principal you are.`;

function parseTimestampToSeconds(ts) {
  const parts = ts.trim().split(":").map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

const isTimestampedFormat = /^\s*\(\d+:\d+(?::\d+)?\s*-\s*\d+:\d+(?::\d+)?\):\s*.+/m.test(userRawText);
console.log("Is timestamped?", isTimestampedFormat);

const lines = userRawText.split('\n');
const sentences = [];
let id = 1;
const regex = /^\s*\(([^)]+)\):\s*(.+)$/;

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const match = regex.exec(trimmed);
  if (match) {
    const timeRange = match[1];
    const sentenceText = match[2];
    const timeParts = timeRange.split("-");
    if (timeParts.length === 2) {
      const start = parseTimestampToSeconds(timeParts[0]);
      const end = parseTimestampToSeconds(timeParts[1]);
      sentences.push({
        id: id++,
        sentence: sentenceText.trim(),
        start,
        end
      });
    }
  }
}
console.log(sentences);
