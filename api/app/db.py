from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url, pool_pre_ping=True)


@event.listens_for(engine, "connect")
def _set_timezone(dbapi_conn, _record) -> None:
    # Server time (Asia/Riyadh) is the only clock that matters (SPEC 2, Rules).
    with dbapi_conn.cursor() as cur:
        cur.execute(f"SET TIME ZONE '{settings.timezone}'")
    dbapi_conn.commit()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
