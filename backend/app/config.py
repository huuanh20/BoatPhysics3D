import os

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'vietnam_to_france_boat_racing_secret!')
    
    # Path to database file backend/game.db
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    DATABASE_PATH = os.environ.get('DATABASE_PATH', os.path.join(BASE_DIR, 'game.db'))
    
    PORT = int(os.environ.get('PORT', 5000))

DATABASE_PATH = Config.DATABASE_PATH
