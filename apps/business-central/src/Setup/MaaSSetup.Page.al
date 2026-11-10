namespace MarketingAsAService;

page 50100 "MaaS Setup"
{
    Caption = 'MarketingAsAService Setup';
    PageType = Card;
    SourceTable = "MaaS Setup";
    ApplicationArea = All;
    UsageCategory = Administration;
    InsertAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            group(Connection)
            {
                Caption = 'Connection';

                field("Server Address"; Rec."Server Address")
                {
                }
            }
        }
    }

    trigger OnOpenPage()
    begin
        Rec.GetOrCreate();
    end;
}
