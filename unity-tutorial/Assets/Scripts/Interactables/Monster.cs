using System.Collections;
using UnityEngine;

/// <summary>
/// 가게 안의 괴물. 대사 → "3코인을 준다" 선택 → 천천히 입을 벌림 → 씨앗 등장.
/// 입은 위/아래 턱 두 개의 피벗(upperJaw, lowerJaw)을 회전시켜 열기 때문에,
/// 나중에 실제 모델로 바꿀 때는 이 두 Transform만 새 뼈대로 연결하면 된다.
/// </summary>
public class Monster : Interactable
{
    enum MonsterState { Idle, Opening, Open }

    [Header("입 (피벗 Transform)")]
    [SerializeField] Transform upperJaw;
    [SerializeField] Transform lowerJaw;
    [SerializeField] Seed seed;

    [Header("입 벌리기")]
    [SerializeField] float upperOpenAngle = 35f;
    [SerializeField] float lowerOpenAngle = 30f;
    [SerializeField] float openDuration = 3f;

    [Header("거래")]
    [SerializeField] int cost = 3;

    MonsterState state = MonsterState.Idle;

    void Reset() => actionLabel = "괴물";

    public override bool CanInteract(PlayerController player) =>
        state == MonsterState.Idle && QuestManager.Instance.Current == QuestStep.TalkToMonster;

    public override void Interact(PlayerController player)
    {
        var gm = GameManager.Instance;

        if (gm.Coins < cost)
        {
            UIManager.Instance.ShowDialog("괴물",
                new[] { "그르르르... (괴물이 빈 손을 보더니 콧김을 내뿜는다)", "...가진 게 없군. 꺼져." },
                null, null);
            return;
        }

        UIManager.Instance.ShowDialog("괴물",
            new[]
            {
                "그르르르르... (괴물이 으르렁거리며 커다란 손을 내민다)",
                "...내놔. 그러면 네가 찾는 걸 주지."
            },
            new[] { $"{cost}코인을 준다", "물러난다" },
            choice =>
            {
                if (choice == 0 && gm.TrySpendCoins(cost))
                    StartCoroutine(OpenMouth());
            });
    }

    IEnumerator OpenMouth()
    {
        state = MonsterState.Opening;
        UIManager.Instance.ShowToast("괴물이 코인을 삼키고, 천천히 입을 벌린다...");

        Quaternion upperStart = upperJaw.localRotation;
        Quaternion lowerStart = lowerJaw.localRotation;
        Quaternion upperEnd = upperStart * Quaternion.Euler(-upperOpenAngle, 0f, 0f);
        Quaternion lowerEnd = lowerStart * Quaternion.Euler(lowerOpenAngle, 0f, 0f);

        float t = 0f;
        while (t < 1f)
        {
            t += Time.deltaTime / Mathf.Max(0.01f, openDuration);
            float k = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t));
            upperJaw.localRotation = Quaternion.Slerp(upperStart, upperEnd, k);
            lowerJaw.localRotation = Quaternion.Slerp(lowerStart, lowerEnd, k);
            yield return null;
        }

        state = MonsterState.Open;
        seed.Reveal();
        QuestManager.Instance.SetStep(QuestStep.TakeSeed);
    }
}
