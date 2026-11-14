from datetime import datetime, timedelta, tzinfo

import pytest


class _ClocksGoBackZone(tzinfo):
    """UTC-4 before the clocks go back (fold 0), UTC-5 after (fold 1), like a DST change.

    Hand-written so the tests need no tzdata, which Windows does not ship.
    """

    def utcoffset(self, dt: datetime | None) -> timedelta:
        return timedelta(hours=-5 if dt is not None and dt.fold else -4)

    def dst(self, dt: datetime | None) -> timedelta:
        return timedelta(0)

    def tzname(self, dt: datetime | None) -> str:
        return "clocks-go-back"


@pytest.fixture
def clocks_go_back_zone() -> tzinfo:
    return _ClocksGoBackZone()
