import fs from 'fs';
import path from 'path';

// Initial mock data is completely empty per user request!
let inMemoryLeaderboard = [];

const TMP_FILE = '/tmp/leaderboard.json';

// Helper to reliably locate the actual project root (workspace directory) in local development
function getProjectRoot() {
  let dir = process.cwd();
  // Traverse up to 5 parent directories to locate the root containing package.json
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const LOCAL_FILE = path.join(getProjectRoot(), 'leaderboard.json');

// Helper to load leaderboard with persistent fallback in project root
function loadLeaderboard() {
  try {
    if (fs.existsSync(LOCAL_FILE)) {
      const data = fs.readFileSync(LOCAL_FILE, 'utf8');
      return JSON.parse(data);
    } else if (fs.existsSync(TMP_FILE)) {
      const data = fs.readFileSync(TMP_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading leaderboard file:", e);
  }
  return inMemoryLeaderboard;
}

// Helper to save leaderboard persistently in project root
function saveLeaderboard(data) {
  try {
    inMemoryLeaderboard = data;
    try {
      fs.writeFileSync(LOCAL_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (localErr) {
      // Vercel serverless read-only container fallback
      fs.writeFileSync(TMP_FILE, JSON.stringify(data, null, 2), 'utf8');
    }
  } catch (e) {
    console.error("Error writing leaderboard file:", e);
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

  if (req.method === 'DELETE') {
    try {
      saveLeaderboard([]);
      return res.status(200).json({ success: true, message: 'Leaderboard cleared successfully' });
    } catch (err) {
      console.error('Error clearing leaderboard:', err);
      return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

