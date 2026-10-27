namespace Zed.Main.MobileApi.Models;

/// <summary>
/// Copy of the old services site's App_Data/EnvironmentalChecklist.json, which GetEsgChecklist
/// returns as is. A file at {Mobile:StorageRoot}/App_Data/EnvironmentalChecklist.json (the old
/// site's copy, if it was edited there) takes precedence.
/// </summary>
internal static class EsgChecklistJson
{
    public const string Text = """"
{
    "version": "1.7",
    "user_name": "ZEDMSME303225",
    "certification_type": "Sliver",
    "sections": [
        {
            "section_title": "ESG check list",
            "fields": [
                {
                    "id": "1",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Are you registered under the Factories Act, 1948?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": []
                },
                {
                    "id": "2",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Is Consent to Establish (COE) and Consent to Operate (COO) applicable to you?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": [
                        {
                            "id": "3",
                            "selected_option": "Yes",
                            "type": "single_choice",
                            "question": "If yes, have you acquired the Certificate?",
                            "options": [
                                "Yes",
                                "No"
                            ],
                            "answer": "",
                            "is_visable": "false",
                            "dependent_fields": []
                        }
                    ]
                },
                {
                    "id": "4",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Does the unit generate solid waste? (e.g sludge, oils, waste chemicals)",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": [
                        {
                            "id": "5",
                            "type": "single_choice",
                            "selected_option": "Yes",
                            "question": "If yes, have you applied for Solid Waste Management Authorization?",
                            "options": [
                                "Yes",
                                "No"
                            ],
                            "answer": "",
                            "is_visable": "false",
                            "dependent_fields": []
                        }
                    ]
                },
                {
                    "id": "6",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Does the unit operations involve handling of hazardous/ dangerous chemicals?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": [
                        {
                            "id": "7",
                            "type": "single_choice",
                            "selected_option": "Yes",
                            "question": "If yes, have your applied for Hazardous Waste Management Authorization?",
                            "options": [
                                "Yes",
                                "No"
                            ],
                            "answer": "",
                            "is_visable": "false",
                            "dependent_fields": []
                        }
                    ]
                },
                {
                    "id": "8",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Does the unit operations produce  E waste?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": [
                        {
                            "id": "9",
                            "type": "single_choice",
                            "selected_option": "Yes",
                            "question": "If yes, do you have Authorised agency for E-waste management and handling?",
                            "options": [
                                "Yes",
                                "No"
                            ],
                            "answer": "",
                            "is_visable": "false",
                            "dependent_fields": []
                        }
                    ]
                },
                {
                    "id": "10",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Does the unit operations produce  Plastic waste?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": [
                        {
                            "id": "11",
                            "type": "single_choice",
                            "selected_option": "Yes",
                            "question": "If yes,  do you have any EPR authorisation agency for waste management / recycle?",
                            "options": [
                                "Yes",
                                "No"
                            ],
                            "answer": "",
                            "is_visable": "false",
                            "dependent_fields": []
                        }
                    ]
                },
                {
                    "id": "12",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Does the unit / project has caused or will cause any health hazard to employees?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": [
                        {
                            "id": "13",
                            "type": "text_box",
                            "selected_option": "Yes",
                            "question": "If yes, specify likely occupational hazards.",
                            "options": [],
                            "answer": "",
                            "is_visable": "false",
                            "dependent_fields": []
                        }
                    ]
                },
                {
                    "id": "14",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Does the unit / project comply with Fire Safety rules & Regulations?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": [
                        {
                            "id": "15",
                            "type": "text_box",
                            "selected_option": "Yes",
                            "question": "If yes, specify potential source of fire hazard and mitigation measures.",
                            "options": [],
                            "answer": "",
                            "is_visable": "false",
                            "dependent_fields": []
                        }
                    ]
                }
            ]
        },
        {
            "section_title": "Social / OHS check list",
            "fields": [
                {
                    "id": "16",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Do you comply with the State’s Minimum Wage regulation?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": []
                },
                {
                    "id": "17",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Do you abide by Child Labour (Prohibition & Regulation) Act?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": []
                },
                {
                    "id": "18",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Do you have safe drinking water arrangements",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": [
                        {
                            "id": "19",
                            "type": "text_box",
                            "selected_option": "No",
                            "question": "If No, the reasons",
                            "options": [],
                            "answer": "",
                            "is_visable": "false",
                            "dependent_fields": []
                        }
                    ]
                },
                {
                    "id": "20",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Do you have First Aid kits?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": []
                },
                {
                    "id": "21",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Is there a separate toilet for women workers",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": []
                },
                {
                    "id": "22",
                    "type": "single_choice",
                    "selected_option": "",
                    "question": "Are there any arrangements for disposal of sanitary pads?",
                    "options": [
                        "Yes",
                        "No",
                        "Not Applicable"
                    ],
                    "answer": "",
                    "is_visable": "true",
                    "dependent_fields": []
                }
            ]
        }
    ]
}
"""";
}
