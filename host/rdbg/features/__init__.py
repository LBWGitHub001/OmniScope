"""Built-in features package."""

from .calibrate import CalibrateFeature
from .dump import DumpFeature
from .fleet_bound import FleetBoundFeature
from .netcheck import NetcheckFeature
from .replay import ReplayFeature
from .swd import SwdFeature
from .watch import WatchFeature


def builtin_features():
    return [
        WatchFeature(),
        CalibrateFeature(),
        ReplayFeature(),
        DumpFeature(),
        NetcheckFeature(),
        SwdFeature(),
    ]


__all__ = [
    "CalibrateFeature",
    "DumpFeature",
    "FleetBoundFeature",
    "NetcheckFeature",
    "ReplayFeature",
    "SwdFeature",
    "WatchFeature",
    "builtin_features",
]
