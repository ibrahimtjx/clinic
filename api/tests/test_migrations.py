import os

from alembic import command
from alembic.config import Config


def test_migrations_upgrade_and_downgrade_cleanly(engine):
    """SPEC 18: every migration is reversible."""
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option(
        "script_location", os.path.join(os.path.dirname(__file__), "..", "migrations")
    )
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
