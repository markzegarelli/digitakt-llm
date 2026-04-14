from unittest.mock import patch

from cli import tui_launcher


def test_wait_for_server_uses_time_without_name_error():
    with patch("cli.tui_launcher.time.monotonic", side_effect=[0.0, 0.5]), patch(
        "cli.tui_launcher.urllib.request.urlopen"
    ) as mock_urlopen:
        assert tui_launcher._wait_for_server("http://localhost:8000/state", timeout=1.0) is True
        mock_urlopen.assert_called_once()
