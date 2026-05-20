import os
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit

app = Flask(__name__, static_folder='.', static_url_path='')
app.config['SECRET_KEY'] = 'vietnam_to_france_boat_racing_secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# 15 premium and interesting quiz questions in Vietnamese
QUESTIONS = [
    {
        "question": "Thủ đô của nước Pháp là thành phố nào?",
        "options": ["Marseille", "Lyon", "Paris", "Nice"],
        "answer": 2
    },
    {
        "question": "Địa danh nào ở Việt Nam được UNESCO công nhận là di sản thiên nhiên thế giới với hàng ngàn hòn đảo đá vôi?",
        "options": ["Vịnh Hạ Long", "Tràng An", "Phong Nha - Kẻ Bàng", "Đảo Phú Quốc"],
        "answer": 0
    },
    {
        "question": "Dòng sông nổi tiếng nào chảy qua trung tâm thủ đô Paris?",
        "options": ["Sông Danube", "Sông Seine", "Sông Thames", "Sông Rhine"],
        "answer": 1
    },
    {
        "question": "Quốc kỳ Việt Nam có hình ngôi sao vàng 5 cánh tượng trưng cho điều gì?",
        "options": ["Năm châu lục", "Năm nhánh sông lớn", "Năm lớp người sĩ, nông, công, thương, binh đoàn kết", "Năm thời kỳ lịch sử"],
        "answer": 2
    },
    {
        "question": "Biểu tượng kiến trúc nổi tiếng thế giới nào được khánh thành tại Paris vào năm 1889?",
        "options": ["Khải Hoàn Môn", "Tháp Eiffel", "Bảo tàng Louvre", "Nhà thờ Đức Bà"],
        "answer": 1
    },
    {
        "question": "Việt Nam nằm ở phía nào của bán đảo Đông Dương?",
        "options": ["Phía Tây", "Phía Đông", "Phía Nam", "Phía Bắc"],
        "answer": 1
    },
    {
        "question": "Sân bay quốc tế lớn nhất tại thủ đô Paris, Pháp có tên là gì?",
        "options": ["Orly", "Charles de Gaulle", "Beauvais", "Le Bourget"],
        "answer": 1
    },
    {
        "question": "Hồ nước ngọt lớn nhất nằm ở trung tâm thủ đô Hà Nội, gắn liền với truyền thuyết trả gươm là hồ nào?",
        "options": ["Hồ Tây", "Hồ Bảy Mẫu", "Hồ Hoàn Kiếm (Hồ Gươm)", "Hồ Thiền Quang"],
        "answer": 2
    },
    {
        "question": "Món ăn chuyên dùng làm bữa sáng của người Pháp kèm bơ hoặc mứt là bánh gì?",
        "options": ["Bánh mì Croissant (Sừng bò)", "Bánh Macaron", "Bánh Crepe", "Bánh Baguette"],
        "answer": 0
    },
    {
        "question": "Ai là người đã tìm ra con đường cứu nước cho dân tộc Việt Nam khi ra đi từ bến cảng Nhà Rồng năm 1911?",
        "options": ["Phan Bội Châu", "Phan Châu Trinh", "Nguyễn Ái Quốc (Hồ Chí Minh)", "Võ Nguyên Giáp"],
        "answer": 2
    },
    {
        "question": "Bảo tàng nghệ thuật lớn nhất thế giới nằm ở Paris, nơi lưu giữ bức tranh nàng Mona Lisa nổi tiếng, tên là gì?",
        "options": ["Bảo tàng Orsay", "Bảo tàng Louvre", "Bảo tàng Pompidou", "Bảo tàng Rodin"],
        "answer": 1
    },
    {
        "question": "Đỉnh núi cao nhất Việt Nam và cũng được mệnh danh là 'Nóc nhà Đông Dương' là đỉnh núi nào?",
        "options": ["Pù Luông", "Tây Côn Lĩnh", "Fansipan", "Mẫu Sơn"],
        "answer": 2
    },
    {
        "question": "Giải đua xe đạp vòng quanh nước Pháp danh giá nhất thế giới có tên gọi là gì?",
        "options": ["Giro d'Italia", "Vuelta a España", "Tour de France", "Paris-Roubaix"],
        "answer": 2
    },
    {
        "question": "Thành phố biển xinh đẹp nào ở miền Trung Việt Nam nổi tiếng với những cây cầu độc đáo và lễ hội bắn pháo hoa quốc tế?",
        "options": ["Nha Trang", "Đà Nẵng", "Vũng Tàu", "Quy Nhơn"],
        "answer": 1
    },
    {
        "question": "Tác phẩm văn học kinh điển 'Những người khốn khổ' (Les Misérables) do nhà văn nổi tiếng nào người Pháp sáng tác?",
        "options": ["Victor Hugo", "Albert Camus", "Alexandre Dumas", "Gustave Flaubert"],
        "answer": 0
    }
]

# Game State
players = {}       # Map of sid -> player details
game_started = False
game_paused = False
winners = []       # List of dictionaries of top 3 winners

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/admin')
def serve_admin():
    return app.send_static_file('admin.html')

# WebSocket Handlers
@socketio.on('connect')
def handle_connect():
    # Send lobby status to the connecting client
    emit('lobby_status', {
        'players': list(players.values()),
        'game_started': game_started
    })

@socketio.on('disconnect')
def handle_disconnect():
    global game_started, winners
    sid = request.sid
    if sid in players:
        removed_player = players.pop(sid)
        print(f"Player disconnected: {removed_player['name']}")
        
        # Reset game if no players are left
        if len(players) == 0:
            game_started = False
            winners = []
            print("No players left. Resetting game state to lobby.")
            
        emit('lobby_status', {
            'players': list(players.values()),
            'game_started': game_started
        }, broadcast=True)

@socketio.on('reset_game')
def handle_reset_game():
    global game_started, winners, game_paused
    game_started = False
    game_paused = False
    winners = []
    
    # Reset stats for all players but keep them connected in lobby
    for sid, p in players.items():
        p['score'] = 0
        p['current_q_idx'] = 0
        p['queue'] = list(range(len(QUESTIONS)))
        p['progress'] = 0.0
        p['rank'] = None
        
    print("Game force reset to Lobby by Admin!")
    emit('game_reset', broadcast=True)
    emit('lobby_status', {
        'players': list(players.values()),
        'game_started': game_started
    }, broadcast=True)

@socketio.on('join_game')
def handle_join_game(data):
    sid = request.sid
    name = data.get('name', 'Anonymous').strip()
    color = data.get('color', '#ff0000')
    
    players[sid] = {
        'sid': sid,
        'name': name,
        'color': color,
        'score': 0,
        'current_q_idx': 0,
        'queue': list(range(len(QUESTIONS))), # Queue of question indices to answer
        'progress': 0.0,
        'rank': None
    }
    
    print(f"Player joined: {name} with color {color} (Game started: {game_started})")
    emit('join_response', {'success': True, 'player': players[sid]})
    emit('lobby_status', {
        'players': list(players.values()),
        'game_started': game_started
    }, broadcast=True)
    
    # If game has already started, transition this specific late-joiner to active quiz screen
    # and send their first question immediately
    if game_started:
        emit('game_started', room=sid)
        q_idx = players[sid]['queue'][players[sid]['current_q_idx']]
        question_data = {
            'question_text': QUESTIONS[q_idx]['question'],
            'options': QUESTIONS[q_idx]['options'],
            'num_answered': players[sid]['score'],
            'total_questions': len(QUESTIONS),
            'progress': players[sid]['progress']
        }
        emit('next_question', question_data, room=sid)

@socketio.on('start_game')
def handle_start_game():
    global game_started, winners, game_paused
    game_started = True
    game_paused = False
    winners = []
    
    # Reset all players
    for sid, p in players.items():
        p['score'] = 0
        p['current_q_idx'] = 0
        p['queue'] = list(range(len(QUESTIONS)))
        p['progress'] = 0.0
        p['rank'] = None
        
    print("Game started by Admin!")
    emit('game_started', broadcast=True)
    
    # Send first question to each player individually
    for sid, p in players.items():
        q_idx = p['queue'][p['current_q_idx']]
        question_data = {
            'question_text': QUESTIONS[q_idx]['question'],
            'options': QUESTIONS[q_idx]['options'],
            'num_answered': p['score'],
            'total_questions': len(QUESTIONS),
            'progress': p['progress']
        }
        socketio.emit('next_question', question_data, room=sid)

@socketio.on('toggle_pause')
def handle_toggle_pause():
    global game_paused, game_started
    if not game_started:
        return
    game_paused = not game_paused
    print(f"Game pause status toggled: {game_paused}")
    emit('pause_status', {'paused': game_paused}, broadcast=True)

@socketio.on('submit_answer')
def handle_submit_answer(data):
    global game_started, game_paused
    sid = request.sid
    if sid not in players or not game_started or game_paused:
        return
        
    player = players[sid]
    answer_idx = data.get('answer')
    
    # Get current question index from player's queue
    current_in_queue = player['current_q_idx']
    if current_in_queue >= len(player['queue']):
        return # Already answered all
        
    actual_q_idx = player['queue'][current_in_queue]
    correct_ans = QUESTIONS[actual_q_idx]['answer']
    
    is_correct = (answer_idx == correct_ans) or (answer_idx == -99)
    
    if is_correct:
        player['score'] += 1
        # Advance the queue index
        player['current_q_idx'] += 1
    else:
        # Move the failed question index to the end of the queue
        player['queue'].append(actual_q_idx)
        # Advance queue index to point to the next question
        player['current_q_idx'] += 1
        
    # Calculate progress based on unique correct answers
    player['progress'] = min(1.0, player['score'] / len(QUESTIONS))
    
    # Check if this player just finished the race
    finished = (player['score'] == len(QUESTIONS))
    if finished and player['rank'] is None:
        rank = len(winners) + 1
        player['rank'] = rank
        winners.append({
            'sid': sid,
            'name': player['name'],
            'color': player['color'],
            'rank': rank
        })
        print(f"Player {player['name']} finished in position {rank}!")
        
        # Broadcast winner finish event
        emit('player_finished', {
            'sid': sid,
            'name': player['name'],
            'color': player['color'],
            'rank': rank
        }, broadcast=True)
        
        # If a human player finishes, auto-finish up to 2 bots to fill the podium.
        # This triggers the game_over state immediately so they don't get stuck, and lets other bots explode!
        if not player['name'].startswith("Captain"):
            bots_in_game = [p for p in players.values() if p['name'].startswith("Captain") and p['rank'] is None]
            bots_to_finish = bots_in_game[:2]
            for bot in bots_to_finish:
                bot_rank = len(winners) + 1
                bot['score'] = len(QUESTIONS)
                bot['progress'] = 1.0
                bot['rank'] = bot_rank
                winners.append({
                    'sid': bot['sid'],
                    'name': bot['name'],
                    'color': bot['color'],
                    'rank': bot_rank
                })
                emit('progress_update', {
                    'sid': bot['sid'],
                    'name': bot['name'],
                    'color': bot['color'],
                    'progress': 1.0,
                    'rank': bot_rank
                }, broadcast=True)
                emit('player_finished', {
                    'sid': bot['sid'],
                    'name': bot['name'],
                    'color': bot['color'],
                    'rank': bot_rank
                }, broadcast=True)
        
        # Check if we have 3 winners or all connected players finished
        active_players_count = len(players)
        limit = min(3, active_players_count)
        if len(winners) >= limit:
            game_started = False
            print("Target winners reached! Ending game...")
            emit('game_over', {
                'winners': winners,
                'players': list(players.values())
            }, broadcast=True)
            return

    # Broadcast position/progress update to everyone (especially admin screen)
    emit('progress_update', {
        'sid': sid,
        'name': player['name'],
        'color': player['color'],
        'progress': player['progress'],
        'rank': player['rank']
    }, broadcast=True)
    
    # Send next question to the player if not finished
    if not finished:
        next_in_queue = player['current_q_idx']
        next_actual_q_idx = player['queue'][next_in_queue]
        
        question_data = {
            'question_text': QUESTIONS[next_actual_q_idx]['question'],
            'options': QUESTIONS[next_actual_q_idx]['options'],
            'num_answered': player['score'],
            'total_questions': len(QUESTIONS),
            'progress': player['progress'],
            'last_correct': is_correct
        }
        emit('next_question', question_data, room=sid)
    else:
        # Send victory screen info to player
        emit('victory', {
            'rank': player['rank']
        }, room=sid)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting server on port {port}...")
    socketio.run(app, host='0.0.0.0', port=port, debug=True)
