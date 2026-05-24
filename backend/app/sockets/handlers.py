import time
import random
from flask import request
from flask_socketio import emit
from backend.app.database.db import get_all_questions, save_leaderboard_record
from backend.app.utils.filter import clean_name

# Game configuration
TARGET_CORRECT_ANSWERS = 15

# Global in-memory states
players = {}       # Map of sid -> player details
game_started = False
game_paused = False
winners = []       # List of dictionaries of top 3 winners
QUESTIONS = []     # Will load dynamically from SQLite during runtime

def load_questions_from_db():
    global QUESTIONS
    QUESTIONS = get_all_questions()
    if not QUESTIONS:
        print("Warning: Database questions list is empty! Ensure SQLite is initialized.")
    return QUESTIONS

def register_socket_handlers(socketio):
    
    @socketio.on('connect')
    def handle_connect():
        # Ensure questions are loaded
        if not QUESTIONS:
            load_questions_from_db()
            
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
        
        # Load fresh questions from DB on reset
        load_questions_from_db()
        
        # Reset stats for all players but keep them connected in lobby
        for sid, p in players.items():
            p['score'] = 0
            p['current_q_idx'] = 0
            p['queue'] = random.sample(range(len(QUESTIONS)), len(QUESTIONS)) if QUESTIONS else []
            p['progress'] = 0.0
            p['rank'] = None
            p['start_time'] = 0
            p['race_time'] = 0
            
        print("Game force reset to Lobby by Admin!")
        emit('game_reset', broadcast=True)
        emit('lobby_status', {
            'players': list(players.values()),
            'game_started': game_started
        }, broadcast=True)

    @socketio.on('join_game')
    def handle_join_game(data):
        # Make sure questions are ready
        if not QUESTIONS:
            load_questions_from_db()
            
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
            # Shuffled queue
            'queue': random.sample(range(len(QUESTIONS)), len(QUESTIONS)) if QUESTIONS else [],
            'progress': 0.0,
            'rank': None,
            'last_answer_time': 0,
            'start_time': time.time() if game_started else 0, # If late join, start race time immediately
            'race_time': 0
        }
        
        print(f"Player joined: {name} with color {color} (Game started: {game_started})")
        emit('join_response', {'success': True, 'player': players[sid]})
        emit('lobby_status', {
            'players': list(players.values()),
            'game_started': game_started
        }, broadcast=True)
        
        # If game has already started, transition this specific late-joiner to active quiz screen
        if game_started and QUESTIONS:
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
        
        # Reload questions dynamically to get any admin changes
        load_questions_from_db()
        
        # Reset all players
        start_timestamp = time.time()
        for sid, p in players.items():
            p['score'] = 0
            p['current_q_idx'] = 0
            p['queue'] = random.sample(range(len(QUESTIONS)), len(QUESTIONS)) if QUESTIONS else []
            p['progress'] = 0.0
            p['rank'] = None
            p['start_time'] = start_timestamp
            p['race_time'] = 0
            
        print("Game started by Admin!")
        emit('game_started', broadcast=True)
        
        # Send first question to each player individually
        if QUESTIONS:
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
            
            # Calculate actual race time in seconds
            race_time = now - player.get('start_time', now)
            player['race_time'] = race_time
            
            winners.append({
                'sid': sid,
                'name': player['name'],
                'color': player['color'],
                'rank': rank,
                'race_time': race_time
            })
            print(f"Player {player['name']} finished in position {rank}! Time: {race_time:.2f}s")
            
            # SAVE to SQLite Leaderboard
            try:
                save_leaderboard_record(
                    name=player['name'],
                    color=player['color'],
                    rank=rank,
                    score=player['score'],
                    race_time=race_time
                )
            except Exception as ex:
                print(f"Failed to save leaderboard to DB: {ex}")
            
            # Broadcast winner finish event
            emit('player_finished', {
                'sid': sid,
                'name': player['name'],
                'color': player['color'],
                'rank': rank,
                'race_time': round(race_time, 2)
            }, broadcast=True)
            
            # If a human player finishes, auto-finish up to 2 bots to fill the podium.
            # This triggers the game_over state immediately so they don't get stuck, and lets other bots explode!
            if not player['name'].startswith("Captain"):
                bots_in_game = [p for p in players.values() if p['name'].startswith("Captain") and p['rank'] is None]
                bots_to_finish = bots_in_game[:2]
                for idx, bot in enumerate(bots_to_finish):
                    bot_rank = len(winners) + 1
                    bot['score'] = TARGET_CORRECT_ANSWERS
                    bot['progress'] = 1.0
                    bot['rank'] = bot_rank
                    
                    # Generate believable bot finish time (slightly slower than human player)
                    bot_time = race_time + random.uniform(3.0, 12.0)
                    bot['race_time'] = bot_time
                    
                    winners.append({
                        'sid': bot['sid'],
                        'name': bot['name'],
                        'color': bot['color'],
                        'rank': bot_rank,
                        'race_time': bot_time
                    })
                    
                    # Save bot to SQLite
                    try:
                        save_leaderboard_record(
                            name=bot['name'],
                            color=bot['color'],
                            rank=bot_rank,
                            score=TARGET_CORRECT_ANSWERS,
                            race_time=bot_time
                        )
                    except Exception as ex:
                        print(f"Failed to save bot leaderboard to DB: {ex}")
                        
                    emit('progress_update', {
                        'sid': bot['sid'],
                        'name': bot['name'],
                        'color': bot['color'],
                        'progress': 1.0,
                        'rank': bot_rank,
                        'race_time': round(bot_time, 2)
                    }, broadcast=True)
                    
                    emit('player_finished', {
                        'sid': bot['sid'],
                        'name': bot['name'],
                        'color': bot['color'],
                        'rank': bot_rank,
                        'race_time': round(bot_time, 2)
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
