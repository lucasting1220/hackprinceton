class BaseOptions:
    def __init__(
        self,
        model_asset_path: str | None = None,
        model_asset_buffer: bytes | None = None,
        delegate: object | None = None,
    ) -> None: ...
