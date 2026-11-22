using UnityEngine;

/// <summary>
/// 괴물의 입 안에 있는 씨앗. 괴물이 입을 다 벌리면 Reveal()로 나타난다.
/// 상호작용하면 인벤토리에 '씨앗'이 추가된다.
/// </summary>
public class Seed : Interactable
{
    void Reset() => actionLabel = "씨앗 줍기";

    /// <summary>씬에서는 비활성 상태로 두고, 괴물이 호출해서 보이게 한다.</summary>
    public void Reveal() => gameObject.SetActive(true);

    public override bool CanInteract(PlayerController player) =>
        QuestManager.Instance.Current == QuestStep.TakeSeed;

    public override void Interact(PlayerController player)
    {
        GameManager.Instance.GiveSeed();
        gameObject.SetActive(false);

        UIManager.Instance.ShowToast("씨앗을 얻었다");
        QuestManager.Instance.SetStep(QuestStep.GoToHouse);
    }
}
