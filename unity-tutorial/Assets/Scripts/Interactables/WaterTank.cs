using UnityEngine;

/// <summary>집 안의 물통. 상호작용하면 '물(얼마 남지 않음)'을 얻고 물 게이지 UI가 나타난다.</summary>
public class WaterTank : Interactable
{
    bool taken;

    void Reset() => actionLabel = "물통";

    public override bool CanInteract(PlayerController player) =>
        !taken && QuestManager.Instance.Current == QuestStep.GetWater;

    public override void Interact(PlayerController player)
    {
        taken = true;
        GameManager.Instance.FillWater();

        UIManager.Instance.ShowToast("물을 얻었다... 얼마 남지 않았다");
        QuestManager.Instance.SetStep(QuestStep.PlantSeed);
    }
}
