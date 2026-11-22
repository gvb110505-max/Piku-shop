using UnityEngine;

/// <summary>낡은 차. 가림막을 씌운 뒤(타이머 시작 후)부터 E로 탑승할 수 있다. 운전은 VehicleController가 담당.</summary>
public class Car : Interactable
{
    [SerializeField] VehicleController vehicle;

    void Reset() => actionLabel = "차 타기";

    public override bool CanInteract(PlayerController player)
    {
        if (vehicle.IsDriven) return false;
        var q = QuestManager.Instance.Current;
        return q == QuestStep.GoToCar || q == QuestStep.DriveToShelter;
    }

    public override void Interact(PlayerController player) => vehicle.Board(player);
}
