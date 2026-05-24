import os
import sys

# Add the workspace root to sys.path to prevent module import errors
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend.app import create_app

app, socketio = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting standard modular game server on port {port}...")
    socketio.run(app, host='0.0.0.0', port=port, debug=True)
