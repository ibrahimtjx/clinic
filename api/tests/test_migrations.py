from alembic import command
from alembic.config import Config


def test_migrations_upgrade_and_downgrade_cleanly():
    """SPEC 18: every migration is reversible."""
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
