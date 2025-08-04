using VendasService as service from '../../srv/vendas/vendas-service';
annotate service.Clientes with @(
    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : nome,
            },
            {
                $Type : 'UI.DataField',
                Value : email,
            },
            {
                $Type : 'UI.DataField',
                Value : telefone,
            },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneratedFacet1',
            Label : 'General Information',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
        {
            $Type  : 'UI.ReferenceFacet',
            Label  : 'Endereços',
            Target : 'enderecos/@UI.LineItem'
        },
    ],
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Value : nome,
        },
        {
            $Type : 'UI.DataField',
            Value : email,
        },
        {
            $Type : 'UI.DataField',
            Value : telefone,
        },
    ],
);

// Anotação para a Tabela de Endereços
annotate VendasService.Enderecos with @(
    UI.LineItem : [
        // Define as colunas que aparecerão na tabela
        { Value: tipo },
        { Value: logradouro },
        { Value: cidade },
        { Value: estado },
        { Value: cep }
    ]
);
