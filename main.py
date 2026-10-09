"""3x3 サバゲーマッチングシステム メインエントリーポイント (main.py)

実行方法:
  python main.py                # シナリオ検証を自動実行
  python main.py --interactive  # 対話型CLIモードを起動 (短縮: python main.py -i)
  python main.py --help         # ヘルプ表示
"""

from __future__ import annotations
import sys
import argparse

# Windows コンソールでの文字化け防止
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from scenarios import run_all_scenarios
from cli import interactive_mode


def main():
    parser = argparse.ArgumentParser(
        description="🎮 3x3 サバゲーマッチングシステム & アルゴリズム検証ツール"
    )
    parser.add_argument(
        "-i",
        "--interactive",
        action="store_true",
        help="対話型CLIモードで起動します",
    )
    parser.add_argument(
        "-t",
        "--test",
        action="store_true",
        help="全シナリオ検証テストを実行します",
    )

    args = parser.parse_args()

    if args.interactive:
        interactive_mode()
    else:
        # デフォルトは全シナリオのシミュレーション実行
        print("=" * 60)
        print("🚀 3x3 サバゲーマッチングシステム シナリオ検証シミュレーション")
        print("=" * 60)
        run_all_scenarios()
        print("\n💡 対話型CLIで手動テストする場合は以下を実行してください:")
        print("   python main.py --interactive\n")


if __name__ == "__main__":
    main()
