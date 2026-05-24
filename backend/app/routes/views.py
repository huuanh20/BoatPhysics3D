from flask import Blueprint, current_app, jsonify, request
import os
import time
import requests
from backend.app.database.db import get_top_leaderboard, save_leaderboard_record

views_bp = Blueprint('views', __name__)

@views_bp.route('/')
def serve_index():
    return current_app.send_static_file('index.html')

@views_bp.route('/admin')
def serve_admin():
    return current_app.send_static_file('admin.html')

@views_bp.route('/api/leaderboard', methods=['GET', 'POST'])
def leaderboard_api():
    if request.method == 'GET':
        try:
            data = get_top_leaderboard(limit=15)
            return jsonify({
                "success": True,
                "leaderboard": data
            })
        except Exception as e:
            print(f"Error fetching leaderboard: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500
    elif request.method == 'POST':
        try:
            data = request.json
            if not data:
                return jsonify({"success": False, "error": "No data provided"}), 400
            
            name = data.get('name')
            color = data.get('color', '#ffffff')
            rank = data.get('rank')
            score = data.get('score', 15)
            race_time = data.get('race_time')
            
            if not name or not rank or race_time is None:
                return jsonify({"success": False, "error": "Missing required fields"}), 400
                
            save_leaderboard_record(name, color, rank, score, race_time)
            return jsonify({"success": True})
        except Exception as e:
            print(f"Error saving leaderboard: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

@views_bp.route('/api/ably-token', methods=['GET'])
def ably_token_api():
    client_id = request.args.get('clientId', '').strip()
    if not client_id:
        client_id = f"anon-{int(time.time() * 1000)}"
        
    api_key = os.environ.get('ABLY_API_KEY', '').strip()
    
    # Tự động quét tìm file .env ở các thư mục cha để lấy ABLY_API_KEY nếu chạy ở local
    if not api_key:
        try:
            curr_dir = os.path.dirname(os.path.abspath(__file__))
            for _ in range(5):
                env_path = os.path.join(curr_dir, '.env')
                if os.path.exists(env_path):
                    with open(env_path, 'r', encoding='utf-8') as f:
                        for line in f:
                            if line.strip().startswith('ABLY_API_KEY='):
                                api_key = line.split('=', 1)[1].strip()
                                break
                    if api_key:
                        break
                curr_dir = os.path.dirname(curr_dir)
        except Exception as e:
            print(f"Lỗi khi quét tìm file .env: {e}")
            
    if not api_key:
        return jsonify({
            "error": "ABLY_API_KEY is not configured",
            "hint": "Vui lòng cấu hình biến môi trường ABLY_API_KEY trong file .env hoặc hệ thống để chạy multiplayer!"
        }), 500

    try:
        # Gọi trực tiếp REST API của Ably để xin token details (tương thích hoàn hảo với JS SDK)
        url = "https://rest.ably.io/tokens"
        parts = api_key.split(':')
        if len(parts) != 2:
            return jsonify({"error": "Định dạng ABLY_API_KEY không đúng! Phải là 'app_id:key_secret'"}), 500
            
        key_name, key_secret = parts[0], parts[1]
        
        payload = {
            "clientId": client_id,
            "capability": {
                "boat:*": ["publish", "subscribe", "presence"]
            }
        }
        
        response = requests.post(
            url,
            json=payload,
            auth=(key_name, key_secret),
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 201:
            return jsonify({
                "error": "Lỗi phản hồi từ Ably API khi xin token",
                "detail": response.text
            }), response.status_code
            
        token_details = response.json()
        return jsonify(token_details)
        
    except Exception as e:
        return jsonify({
            "error": "Lỗi hệ thống khi sinh Ably token",
            "detail": str(e)
        }), 500


