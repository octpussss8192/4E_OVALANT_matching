import os
import tempfile
from pathlib import Path
import pytest

# テスト実行時は環境変数でテストモードを設定
os.environ["TESTING"] = "1"
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_KEY"] = ""
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""
os.environ["SUPABASE_ANON_KEY"] = ""
os.environ["NEXT_PUBLIC_SUPABASE_URL"] = ""
os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = ""


@pytest.fixture(scope="session", autouse=True)
def isolate_test_environment():
    """本番環境（Supabase等）からテスト環境を完全に隔離"""
    import backend.app.api as api_module

    api_module.engine.disable_supabase = True
    temp_dir = tempfile.TemporaryDirectory()
    api_module.engine.storage_path = Path(temp_dir.name) / "test_matching_state.json"
    api_module.engine.reset()

    yield

    temp_dir.cleanup()
