"""Layer 4 value checks shared by the settings and the signals.

bool is a subclass of int in Python, so True would otherwise pass as the number 1.
"""


def is_number(value: object) -> bool:
    """True for an int or a float, never for a bool."""
    return isinstance(value, int | float) and not isinstance(value, bool)


def is_whole_number(value: object) -> bool:
    """True for an int, never for a bool or a float."""
    return isinstance(value, int) and not isinstance(value, bool)
