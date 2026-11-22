using UnityEngine;

/// <summary>
/// 한글이 나오는 폰트를 한 번만 만들어 공유한다. (UI Text / TextMesh 공용)
/// 나중에 TextMeshPro나 프로젝트 전용 폰트로 바꾸려면 이 클래스만 고치면 된다.
/// </summary>
public static class FontProvider
{
    static Font cached;

    public static Font Get()
    {
        if (cached != null) return cached;

        cached = Font.CreateDynamicFontFromOSFont(
            new[] { "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "NanumGothic", "Noto Sans CJK KR", "Noto Sans KR", "Arial" },
            48);

        if (cached == null)
            cached = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        return cached;
    }
}
