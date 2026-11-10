namespace MarketingAsAService;

/// <summary>
/// The connection of this company to a MarketingAsAService workspace. One record per company.
/// </summary>
table 50100 "MaaS Setup"
{
    Caption = 'MarketingAsAService Setup';
    DataClassification = CustomerContent;
    DrillDownPageId = "MaaS Setup";
    LookupPageId = "MaaS Setup";

    fields
    {
        field(1; "Primary Key"; Code[10])
        {
            Caption = 'Primary Key';
            AllowInCustomizations = Never;
        }
        field(2; "Server Address"; Text[250])
        {
            Caption = 'Server Address';
            ExtendedDatatype = URL;
            ToolTip = 'Specifies the address of your MarketingAsAService server, for example https://marketing.example.com.';

            trigger OnValidate()
            begin
                "Server Address" := CopyStr(CleanAddress("Server Address"), 1, MaxStrLen("Server Address"));
            end;
        }
    }

    keys
    {
        key(PK; "Primary Key")
        {
            Clustered = true;
        }
    }

    var
        HttpsErr: Label 'The address must start with https://, for example https://marketing.example.com.';

    /// <summary>
    /// Reads the setup record and creates it the first time.
    /// </summary>
    procedure GetOrCreate()
    begin
        Reset();
        if Get() then
            exit;
        Init();
        Insert(true);
    end;

    local procedure CleanAddress(Address: Text): Text
    begin
        Address := Address.Trim().TrimEnd('/');
        if (Address <> '') and not Address.ToLower().StartsWith('https://') then
            Error(HttpsErr);
        exit(Address);
    end;
}
