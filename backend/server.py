import os
import random
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit

app = Flask(__name__, static_folder='../frontend', static_url_path='')
app.config['SECRET_KEY'] = 'vietnam_to_france_boat_racing_secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# 15 premium and interesting quiz questions in Vietnamese
QUESTIONS = [
    {
        "question": "Đặc điểm lớn nhất của thời kỳ quá độ lên CNXH ở Việt Nam là gì?",
        "options": [
            "Tập trung phát triển công nghiệp nặng và máy móc.",
            "Bỏ qua chế độ tư bản.",
            "Xây dựng nền văn hóa tiên tiến và đậm đà bản sắc.",
            "Ưu tiên phát triển các thành phần kinh tế tư nhân."
        ],
        "answer": 1
    },
    {
        "question": "Hồ Chí Minh xác định nhiệm vụ kinh tế trọng tâm của thời kỳ quá độ là gì?",
        "options": [
            "Mở rộng giao thương với các nước tư bản chủ nghĩa.",
            "Thực hiện ngay việc xóa bỏ mọi hình thức sở hữu tư.",
            "Tập trung vào việc xuất khẩu nông sản ra thế giới.",
            "Xây dựng nền vật chất."
        ],
        "answer": 3
    },
    {
        "question": "Theo Hồ Chí Minh, thời kỳ quá độ lên CNXH ở Việt Nam là một quá trình như thế nào?",
        "options": [
            "Khó khăn, phức tạp.",
            "Diễn ra nhanh chóng nhờ sự giúp đỡ từ bên ngoài.",
            "Đơn giản vì nhân dân ta có truyền thống yêu nước.",
            "Chỉ tập trung vào việc cải tạo tư tưởng của dân."
        ],
        "answer": 0
    },
    {
        "question": "Nguyên tắc nào được Hồ Chí Minh nhấn mạnh trong xây dựng CNXH?",
        "options": [
            "Nhà nước quản lý toàn bộ các hoạt động cá nhân.",
            "Chỉ học tập kinh nghiệm từ các nước xã hội chủ nghĩa.",
            "Dân làm chủ.",
            "Chạy theo năng suất lao động bằng mọi giá hiện nay."
        ],
        "answer": 2
    },
    {
        "question": "Trong thời kỳ quá độ, chúng ta phải chống lại 'loại giặc' nào?",
        "options": [
            "Các thế lực phản động từ các nước láng giềng gần.",
            "Giặc nội xâm.",
            "Những người có tư tưởng bảo thủ trong nông nghiệp.",
            "Sự ảnh hưởng của các trào lưu văn hóa từ phương Tây."
        ],
        "answer": 1
    },
    {
        "question": "Hồ Chí Minh quan niệm thế nào về các bước đi trong thời kỳ quá độ?",
        "options": [
            "Tiến nhanh, tiến mạnh để kịp trình độ thế giới.",
            "Phải rập khuôn máy móc theo mô hình của Liên Xô.",
            "Thận trọng, từng bước.",
            "Chỉ cần tập trung vào các thành phố lớn trước tiên."
        ],
        "answer": 2
    },
    {
        "question": "Đâu là động lực quan trọng nhất của CNXH theo Hồ Chí Minh?",
        "options": [
            "Trí tuệ nhân tạo và các thuật toán tự động hóa.",
            "Nguồn tài nguyên thiên nhiên phong phú của đất nước.",
            "Vốn đầu tư trực tiếp từ các tổ chức quốc tế lớn.",
            "Con người."
        ],
        "answer": 3
    },
    {
        "question": "Nhiệm vụ chính trị cốt lõi trong thời kỳ quá độ là gì?",
        "options": [
            "Xây dựng dân chủ.",
            "Thiết lập hệ thống pháp luật dựa trên AI hoàn toàn.",
            "Hạn chế quyền tự do ngôn luận để giữ ổn định xã hội.",
            "Tập trung quyền lực vào một nhóm nhỏ các chuyên gia."
        ],
        "answer": 0
    },
    {
        "question": "Để xây dựng thành công CNXH, chúng ta cần loại người nào?",
        "options": [
            "Những chuyên gia công nghệ có trình độ cao nhất.",
            "Người xã hội chủ nghĩa.",
            "Những người chỉ biết chấp hành mệnh lệnh cấp trên.",
            "Các nhà đầu tư có nguồn vốn tài chính dồi dào nhất."
        ],
        "answer": 1
    },
    {
        "question": "Hồ Chí Minh cảnh báo điều gì khi học tập kinh nghiệm nước ngoài?",
        "options": [
            "Phải áp dụng chính xác các bước đi của các nước.",
            "Tránh rập khuôn.",
            "Tuyệt đối không được thay đổi các công thức sẵn có.",
            "Chỉ học tập về mặt công nghệ kỹ thuật mà thôi."
        ],
        "answer": 1
    },
    {
        "question": "Mối quan hệ giữa độc lập dân tộc và CNXH là gì?",
        "options": [
            "Là hai giai đoạn riêng biệt không liên quan nhau.",
            "Độc lập dân tộc chỉ là mục tiêu phụ của CNXH.",
            "Biện chứng, khăng khít.",
            "CNXH chỉ là công cụ để giành lại độc lập dân tộc."
        ],
        "answer": 2
    },
    {
        "question": "Độc lập dân tộc có vai trò gì đối với CNXH?",
        "options": [
            "Là kết quả cuối cùng của quá trình xây dựng CNXH.",
            "Là yếu tố làm chậm quá trình tiến lên xã hội mới.",
            "Là mục tiêu duy nhất của cuộc cách mạng Việt Nam.",
            "Là tiền đề, cơ sở."
        ],
        "answer": 3
    },
    {
        "question": "Tại sao chỉ có CNXH mới giữ vững được độc lập dân tộc?",
        "options": [
            "Tạo sức mạnh tự thân.",
            "Nhờ sự hỗ trợ quân sự từ các nước lớn cùng khối.",
            "Vì CNXH ngăn chặn hoàn toàn mọi ý định xâm lược.",
            "Do CNXH có hệ thống phòng thủ công nghệ cao nhất."
        ],
        "answer": 0
    },
    {
        "question": "Hồ Chí Minh khẳng định độc lập phải gắn liền với điều gì?",
        "options": [
            "Sự tăng trưởng GDP vượt bậc trong thời gian ngắn.",
            "Tự do, hạnh phúc.",
            "Việc sở hữu các loại vũ khí hạt nhân để răn đe.",
            "Sự lãnh đạo của một cá nhân kiệt xuất duy nhất."
        ],
        "answer": 1
    },
    {
        "question": "'Sợi chỉ đỏ' của cách mạng Việt Nam là gì?",
        "options": [
            "Phát triển kinh tế nhanh và hội nhập quốc tế sâu.",
            "Cải cách giáo dục gắn liền với đổi mới công nghệ.",
            "Độc lập và CNXH.",
            "Xây dựng quân đội mạnh và củng cố biên giới quốc gia."
        ],
        "answer": 2
    },
    {
        "question": "Điều kiện tiên quyết để giữ vững độc lập gắn liền CNXH là gì?",
        "options": [
            "Phải có nền kinh tế đứng đầu khu vực Đông Nam Á.",
            "Tham gia vào tất cả các liên minh quân sự thế giới.",
            "Ứng dụng AI vào việc quản lý dân cư và xã hội.",
            "Đảng lãnh đạo."
        ],
        "answer": 3
    },
    {
        "question": "Mục tiêu cuối cùng của độc lập dân tộc và CNXH đều hướng tới:",
        "options": [
            "Giải phóng con người.",
            "Trở thành cường quốc công nghệ số trong tương lai.",
            "Xây dựng một xã hội chỉ có sự giàu sang về vật chất.",
            "Xóa bỏ hoàn toàn biên giới giữa các quốc gia dân tộc."
        ],
        "answer": 0
    },
    {
        "question": "Để bảo vệ độc lập dân tộc, chúng ta cần kết hợp sức mạnh nào?",
        "options": [
            "Sức mạnh quân sự và tiềm lực tài chính của cá nhân.",
            "Dân tộc và thời đại.",
            "Sự hỗ trợ từ AI và nguồn tài nguyên thiên nhiên.",
            "Sức mạnh của đa số và quyền lực của giới thượng lưu."
        ],
        "answer": 1
    },
    {
        "question": "Theo Hồ Chí Minh, CNXH giúp gì cho mỗi cá nhân?",
        "options": [
            "Có mức thu nhập cao hơn tất cả các nước tư bản.",
            "Được làm việc ít hơn nhưng hưởng thụ nhiều hơn.",
            "Phát triển toàn diện.",
            "Trở thành những chuyên gia công nghệ hàng đầu thế giới."
        ],
        "answer": 2
    },
    {
        "question": "Bản chất của CNXH mà Hồ Chí Minh hướng tới là gì?",
        "options": [
            "Nhà nước quản lý mọi mặt đời sống một cách tuyệt đối.",
            "Một xã hội chỉ tập trung vào sự giàu có của một nhóm.",
            "Một hệ thống vận hành hoàn toàn bằng trí tuệ nhân tạo.",
            "Nhân dân làm chủ."
        ],
        "answer": 3
    },
    {
        "question": "Trong thời đại số, 'Dĩ bất biến' đối với mỗi cá nhân là gì?",
        "options": [
            "Giá trị nhân văn.",
            "Kỹ năng sử dụng các phần mềm máy tính mới nhất.",
            "Công việc có mức lương ổn định suốt cả cuộc đời.",
            "Các quan điểm sống từ thời phong kiến còn sót lại."
        ],
        "answer": 0
    },
    {
        "question": "'Bẫy định hướng' lớn nhất trong thời đại AI là gì?",
        "options": [
            "Không biết cách sử dụng trí tuệ nhân tạo hiệu quả.",
            "Nhầm mục tiêu - công cụ.",
            "Bị tụt hậu so với sự phát triển của bạn bè cùng trang lứa.",
            "Thiếu nguồn vốn để đầu tư vào các công nghệ mới hiện nay."
        ],
        "answer": 1
    },
    {
        "question": "Coi 'tiền bạc' hay 'nghề nghiệp hot' là đích đến cuối cùng gọi là:",
        "options": [
            "Sự phát triển đúng đắn của con người trong thời đại số.",
            "Cách để đạt được hạnh phúc bền vững và tự do thực sự.",
            "Mục tiêu hóa công cụ.",
            "Chiến lược thích ứng linh hoạt với thị trường lao động."
        ],
        "answer": 2
    },
    {
        "question": "Theo nguồn tài liệu, AI, Big Data hay ChatGPT nên được coi là:",
        "options": [
            "Đích đến cuối cùng của việc học tập tại bậc đại học.",
            "Yếu tố thay thế hoàn toàn cho tư duy của con người.",
            "Mục tiêu cao nhất của sự nghiệp cách mạng hiện nay.",
            "Công cụ phục vụ."
        ],
        "answer": 3
    },
    {
        "question": "Phương châm hành động trước sự biến động của công nghệ là:",
        "options": [
            "Tâm bất biến.",
            "Chạy theo mọi xu hướng mới nhất trên mạng xã hội.",
            "Ngừng học tập để giữ gìn những giá trị truyền thống cũ.",
            "Tuyệt đối tin tưởng vào các quyết định của trí tuệ nhân tạo."
        ],
        "answer": 0
    },
    {
        "question": "Vận dụng tư tưởng Hồ Chí Minh hiện nay cần thực hiện tốt điều gì?",
        "options": [
            "Chỉ tập trung vào việc phát triển các khu kinh tế lớn.",
            "Xây đi đôi với chống.",
            "Ưu tiên lợi ích của các tập đoàn công nghệ đa quốc gia.",
            "Hạn chế sự can thiệp của người dân vào việc quản lý nhà nước."
        ],
        "answer": 1
    },
    {
        "question": "Để không thành 'nô lệ' của công nghệ, con người cần xác lập:",
        "options": [
            "Hệ thống bảo mật thông tin cá nhân vững chắc nhất.",
            "Các mối quan hệ với những người giỏi về lập trình AI.",
            "Kim chỉ nam nhân văn.",
            "Một mức thu nhập đủ cao để mua sắm các thiết bị mới nhất."
        ],
        "answer": 2
    },
    {
        "question": "Theo Hồ Chí Minh, muốn dân giàu nước mạnh thì phải gắn liền với:",
        "options": [
            "Sự phát triển tự phát của các thành phần kinh tế tư nhân.",
            "Việc nhập khẩu toàn bộ dây chuyền sản xuất từ nước ngoài.",
            "Sự hỗ trợ tài chính không điều kiện từ các tổ chức quốc tế.",
            "Chủ nghĩa xã hội."
        ],
        "answer": 3
    },
    {
        "question": "Trong 'Văn bản được dán', lý do con người hiện đại dễ lạc lối là:",
        "options": [
            "Công cụ quá hấp dẫn.",
            "Không đủ thời gian để học các kỹ năng công nghệ mới.",
            "Các thuật toán AI chưa đủ thông minh để hướng dẫn người.",
            "Sự thiếu hụt các tài liệu về tư tưởng Hồ Chí Minh hiện nay."
        ],
        "answer": 0
    },
    {
        "question": "Mục tiêu của việc học tập theo gương Hồ Chí Minh hiện nay là gì?",
        "options": [
            "Để có một chứng chỉ nghề nghiệp hot nhất thị trường AI.",
            "Phụng sự nhân dân.",
            "Nhằm chứng tỏ bản thân thông minh hơn người khác hiện nay.",
            "Tìm kiếm cơ hội định cư và làm việc tại các nước tư bản lớn."
        ],
        "answer": 1
    }
]

# Game State
TARGET_CORRECT_ANSWERS = 15
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
        p['queue'] = random.sample(range(len(QUESTIONS)), len(QUESTIONS))
        p['progress'] = 0.0
        p['rank'] = None
        
    print("Game force reset to Lobby by Admin!")
    emit('game_reset', broadcast=True)
    emit('lobby_status', {
        'players': list(players.values()),
        'game_started': game_started
    }, broadcast=True)

def clean_name(name):
    # Ràng buộc độ dài: tối đa 15 ký tự
    if len(name) > 15:
        name = name[:12] + "..."
    # Bộ lọc từ ngữ nhạy cảm (profanity filter)
    bad_words = ["dm", "vcl", "cl", "cac", "lon", "fuck", "shit"]
    words = name.split()
    cleaned = []
    for w in words:
        if w.lower() in bad_words:
            cleaned.append("***")
        else:
            cleaned.append(w)
    return " ".join(cleaned)

@socketio.on('join_game')
def handle_join_game(data):
    sid = request.sid
    raw_name = data.get('name', 'Anonymous').strip()
    name = clean_name(raw_name)
    color = data.get('color', '#ff0000')
    
    # Ràng buộc nếu vào muộn sau khi game đã bắt đầu: thêm nhãn [LATE] để báo hiệu
    if game_started:
        name = f"[LATE] {name}"
        if len(name) > 15:
            name = name[:15]
            
    players[sid] = {
        'sid': sid,
        'name': name,
        'color': color,
        'score': 0,
        'current_q_idx': 0,
        'queue': random.sample(range(len(QUESTIONS)), len(QUESTIONS)), # Shuffled queue
        'progress': 0.0,
        'rank': None,
        'last_answer_time': 0
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
            'total_questions': TARGET_CORRECT_ANSWERS,
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
        p['queue'] = random.sample(range(len(QUESTIONS)), len(QUESTIONS))
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
    
    # Ràng buộc chống cheat/spam: Mỗi câu trả lời cách nhau tối thiểu 0.8 giây
    import time
    now = time.time()
    last_time = player.get('last_answer_time', 0)
    if now - last_time < 0.8:
        print(f"Anti-spam protection triggered for player: {player['name']} (Answers submitted too fast!)")
        return
    player['last_answer_time'] = now
    
    answer_idx = data.get('answer')
    
    # Get current question index from player's queue
    current_in_queue = player['current_q_idx']
    if current_in_queue >= len(player['queue']):
        return # Already answered all
        
    actual_q_idx = player['queue'][current_in_queue]
    correct_ans = QUESTIONS[actual_q_idx]['answer']
    
    is_correct = (answer_idx == correct_ans)
    
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
    player['progress'] = min(1.0, player['score'] / TARGET_CORRECT_ANSWERS)
    
    # Check if this player just finished the race
    finished = (player['score'] >= TARGET_CORRECT_ANSWERS)
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
                bot['score'] = TARGET_CORRECT_ANSWERS
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
