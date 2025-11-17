#!/usr/bin/env python3
"""
Test script to verify the historical reference detection fix.

This tests that the word-boundary matching prevents false positives
where "entered into" was incorrectly matching "previously entered into".

Test cases:
1. "On November 13, 2025, Cidara entered into a merger" - Should NOT be flagged
2. "Company previously entered into an agreement" - SHOULD be flagged
3. "The previously announced merger" - SHOULD be flagged

Usage:
    /Users/donaldross/opt/anaconda3/bin/python3 test_historical_reference_fix.py
"""
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.edgar.detector import MADetector

def test_cidara_case():
    """Test the actual Cidara text that was incorrectly flagged"""
    print("=" * 80)
    print("TEST 1: Cidara Same-Day Announcement (Should NOT be flagged)")
    print("=" * 80)

    text = """
    Item 1.01 Entry into a Material Definitive Agreement

    On November 13, 2025, Cidara Therapeutics, Inc. ("Cidara" or the "Company")
    entered into an Agreement and Plan of Merger (the "Merger Agreement") with
    Merck & Co., Inc., a New Jersey corporation ("Parent"), and Artemis Merger
    Sub Inc., a Delaware corporation and a wholly owned subsidiary of Parent.

    Upon the terms and subject to the conditions of the Merger Agreement...
    """

    detector = MADetector(anthropic_api_key="dummy")
    detected_keywords = ["merger", "merger agreement"]

    result = detector.detect_historical_reference_near_keywords(
        text,
        detected_keywords,
        context_radius=300
    )

    print(f"Text sample: '{text[:200]}...'")
    print(f"Detected keywords: {detected_keywords}")
    print(f"Result: {result}")

    if result:
        print("❌ FAIL: Same-day announcement incorrectly flagged as historical")
        return False
    else:
        print("✅ PASS: Same-day announcement correctly NOT flagged")
        return True


def test_actual_historical_reference():
    """Test that actual historical references are still caught"""
    print("\n" + "=" * 80)
    print("TEST 2: Actual Historical Reference (SHOULD be flagged)")
    print("=" * 80)

    text = """
    Item 8.01 Other Events

    As previously disclosed, the Company entered into a merger agreement on
    August 15, 2025. This filing provides an update on the regulatory approval
    process for that previously announced transaction.
    """

    detector = MADetector(anthropic_api_key="dummy")
    detected_keywords = ["merger", "merger agreement"]

    result = detector.detect_historical_reference_near_keywords(
        text,
        detected_keywords,
        context_radius=300
    )

    print(f"Text sample: '{text[:150]}...'")
    print(f"Detected keywords: {detected_keywords}")
    print(f"Result: {result}")

    if result:
        print("✅ PASS: Historical reference correctly flagged")
        return True
    else:
        print("❌ FAIL: Historical reference should have been flagged")
        return False


def test_previously_entered_into():
    """Test that the exact phrase 'previously entered into' is caught"""
    print("\n" + "=" * 80)
    print("TEST 3: Exact phrase 'previously entered into' (SHOULD be flagged)")
    print("=" * 80)

    text = """
    The Company previously entered into an Agreement and Plan of Merger
    on September 1, 2025. This amendment updates certain terms of that
    previously announced transaction.
    """

    detector = MADetector(anthropic_api_key="dummy")
    detected_keywords = ["merger", "amendment"]

    result = detector.detect_historical_reference_near_keywords(
        text,
        detected_keywords,
        context_radius=300
    )

    print(f"Text sample: '{text[:120]}...'")
    print(f"Detected keywords: {detected_keywords}")
    print(f"Result: {result}")

    if result:
        print("✅ PASS: 'previously entered into' correctly flagged")
        return True
    else:
        print("❌ FAIL: 'previously entered into' should have been flagged")
        return False


def test_just_entered_into():
    """Test that plain 'entered into' without 'previously' is NOT caught"""
    print("\n" + "=" * 80)
    print("TEST 4: Plain 'entered into' without 'previously' (Should NOT be flagged)")
    print("=" * 80)

    text = """
    On October 15, 2025, the Company entered into a definitive agreement
    to acquire Target Corp for $100 per share in cash. The transaction is
    expected to close in the first quarter of 2026.
    """

    detector = MADetector(anthropic_api_key="dummy")
    detected_keywords = ["acquire", "acquisition", "transaction"]

    result = detector.detect_historical_reference_near_keywords(
        text,
        detected_keywords,
        context_radius=300
    )

    print(f"Text sample: '{text[:120]}...'")
    print(f"Detected keywords: {detected_keywords}")
    print(f"Result: {result}")

    if result:
        print("❌ FAIL: Plain 'entered into' should NOT be flagged as historical")
        return False
    else:
        print("✅ PASS: Plain 'entered into' correctly NOT flagged")
        return True


def main():
    """Run all tests"""
    print("\n")
    print("╔" + "=" * 78 + "╗")
    print("║" + " " * 15 + "HISTORICAL REFERENCE DETECTION FIX TEST" + " " * 24 + "║")
    print("╚" + "=" * 78 + "╝")
    print()

    results = []

    # Run tests
    results.append(("Cidara Same-Day", test_cidara_case()))
    results.append(("Actual Historical Reference", test_actual_historical_reference()))
    results.append(("Previously Entered Into", test_previously_entered_into()))
    results.append(("Plain Entered Into", test_just_entered_into()))

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")

    print()
    print(f"Results: {passed}/{total} tests passed")

    if passed == total:
        print("\n🎉 All tests passed! The fix works correctly.")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
