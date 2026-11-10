namespace MarketingAsAService;

permissionset 50100 "MaaS Admin"
{
    Caption = 'MarketingAsAService - Admin';
    Assignable = true;

    Permissions =
        table "MaaS Setup" = X,
        tabledata "MaaS Setup" = RIMD,
        page "MaaS Setup" = X;
}
