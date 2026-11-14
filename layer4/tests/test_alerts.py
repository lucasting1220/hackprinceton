from datetime import UTC, datetime, timedelta, timezone

from layer4.alerts import AlertKind, Severity, format_date, format_time, new_alert

EST = timezone(timedelta(hours=-5))


def test_midnight_is_twelve_am() -> None:
    assert format_time(datetime(2026, 11, 14, 0, 0, tzinfo=UTC), UTC) == "12:00 AM"


def test_noon_is_twelve_pm() -> None:
    assert format_time(datetime(2026, 11, 14, 12, 0, tzinfo=UTC), UTC) == "12:00 PM"


def test_time_is_shown_in_the_given_zone() -> None:
    assert format_time(datetime(2026, 11, 14, 3, 12, tzinfo=UTC), EST) == "10:12 PM"


def test_morning_hour_has_no_leading_zero() -> None:
    assert format_time(datetime(2026, 11, 14, 3, 5, tzinfo=UTC), UTC) == "3:05 AM"


def test_no_zone_means_the_laptop_zone() -> None:
    moment = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
    local = moment.astimezone()
    expected = f"{local.hour % 12 or 12}:{local.minute:02d} {'AM' if local.hour < 12 else 'PM'}"
    assert format_time(moment) == expected


def test_date_is_shown_in_the_given_zone() -> None:
    assert format_date(datetime(2026, 11, 14, 3, 12, tzinfo=UTC), EST) == "Nov 13"


def test_new_alert_is_urgent_not_an_update_and_in_utc() -> None:
    detected = datetime(2026, 11, 13, 22, 12, tzinfo=EST)
    alert = new_alert(AlertKind.FALL, detected, "Possible fall", "body")
    assert alert.severity is Severity.URGENT
    assert alert.update is False
    assert alert.detected_at == detected
    assert alert.detected_at.utcoffset() == timedelta(0)
    assert alert.kind == "fall"


def test_two_alerts_get_different_ids() -> None:
    detected = datetime(2026, 11, 14, 3, 12, tzinfo=UTC)
    first = new_alert(AlertKind.HELP, detected, "Call for help", "body")
    second = new_alert(AlertKind.HELP, detected, "Call for help", "body")
    assert first.alert_id != second.alert_id
