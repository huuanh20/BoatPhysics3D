from flask import Flask
from flask_socketio import SocketIO
from backend.app.config import Config
from backend.app.database.db import init_db

socketio = SocketIO()

def create_app():
    # Setup static folder pointing to frontend relative to this file
    app = Flask(
        __name__, 
        static_folder='../../frontend', 
        static_url_path=''
    )
    app.config.from_object(Config)
    
    # Initialize DB (creates database and seeds questions if not exists)
    print("Initializing SQLite database connection...")
    init_db()
    
    # Initialize Socket.IO
    socketio.init_app(app, cors_allowed_origins="*")
    
    # Register blueprints
    from backend.app.routes.views import views_bp
    app.register_blueprint(views_bp)
    
    # Register Socket.IO handlers
    from backend.app.sockets.handlers import register_socket_handlers
    register_socket_handlers(socketio)
    
    return app, socketio
