import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

# Loads variables from .env, for local 
load_dotenv()

# Assign DATABASE_URL 
DATABASE_URL = os.environ["DATABASE_URL"]

# Create connection factory and pre ping DB to ensure its up and reconnect if not
database_url = make_url(DATABASE_URL)
if database_url.drivername in ("postgresql", "postgres"):
    database_url = database_url.set(drivername="postgresql+psycopg2")
engine = create_engine(database_url, pool_pre_ping=True)

def test_db():
    with engine.connect() as conn:
        return conn.execute(text("SELECT 1")).scalar_one()
