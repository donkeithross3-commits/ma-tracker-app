"""Source monitors for M&A intelligence platform"""
from app.intelligence.monitors.ftc_monitor import FTCEarlyTerminationMonitor, create_ftc_monitor
from app.intelligence.monitors.reuters_monitor import ReutersMAMonitor, create_reuters_monitor
from app.intelligence.monitors.seeking_alpha_monitor import SeekingAlphaMAMonitor, create_seeking_alpha_monitor
from app.intelligence.monitors.globenewswire_monitor import (
    GlobeNewswireMonitor,
    create_globenewswire_ma_monitor,
    create_globenewswire_corporate_actions_monitor,
    create_globenewswire_executive_changes_monitor
)

__all__ = [
    "FTCEarlyTerminationMonitor",
    "create_ftc_monitor",
    "ReutersMAMonitor",
    "create_reuters_monitor",
    "SeekingAlphaMAMonitor",
    "create_seeking_alpha_monitor",
    "GlobeNewswireMonitor",
    "create_globenewswire_ma_monitor",
    "create_globenewswire_corporate_actions_monitor",
    "create_globenewswire_executive_changes_monitor",
]
