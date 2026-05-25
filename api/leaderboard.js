import fs from 'fs';
import path from 'path';

// Initial mock data for a lively first impression
let inMemoryLeaderboard = [
  { name: "Captain Hùng", color: "#e74c3c", rank: 1, score: 15, race_time: 42.50, created_at: new Date().toISOString() },
  { name: "Thuyền Trưởng Lan", color: "#3498db", rank: 2, score: 10, race_time: 48.20, created_at: new Date().toISOString() },
  { name: "Sát Thủ Tri Thức", color: "#2ecc71", rank: 3, score: 5, race_time: 55.10, created_at: new Date().toISOString() }
];

const TMP_FILE = '/tmp/leaderboard.json';

// Helper to load leaderboard
function loadLeaderboard() {
  try {
    if (fs.existsSync(TMP_FILE)) {
      const data = fs.readFileSync(TMP_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading temp leaderboard file:", e);
  }
  return inMemoryLeaderboard;
}

// Helper to save leaderboard
function saveLeaderboard(data) {
  try {
    inMemoryLeaderboard = data;
    fs.writeFileSync(TMP_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing temp leaderboard file:", e);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  
  if (req.method === 'GET') {
    const data = loadLeaderboard();
    return res.status(200).json({
      success: true,
      leaderboard: data
    });
  } 
  
  if (req.method === 'POST') {
    try {
      const { name, color, rank, score, race_time } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, error: 'Name is required' });
      }
      
      const currentList = loadLeaderboard();
      
      currentList.push({
        name: String(name).slice(0, 15),
        color: color || '#fff',
        rank: parseInt(rank) || 1,
        score: parseInt(score) || 0,
        race_time: parseFloat(race_time) || 0,
        created_at: new Date().toISOString()
      });
      
      // Sort: rank asc, race_time asc, score desc
      currentList.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (a.race_time !== b.race_time) return a.race_time - b.race_time;
        return b.score - a.score;
      });
      
      // Keep top 15 records
      const updatedList = currentList.slice(0, 15);
      
      // Re-assign ranks dynamically based on order
      updatedList.forEach((r, idx) => {
        r.rank = idx + 1;
      });
      
      saveLeaderboard(updatedList);
      
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Error saving to leaderboard:', err);
      return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
