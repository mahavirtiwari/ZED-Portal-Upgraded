-- Run on ZEDCS_V2_LIVE. Additive and safe to re-run.
-- Surveillance of V4 levels (ZED-X) on a schedule the Admin sets (Administration → Certification Levels). Bronze, Silver
-- and Gold keep their legacy jobs (Zed.Jobs: Silver_Gold_Surveillance_Data_job, Silver_Gold_Second_Surveillance_Data_job,
-- AutoSuspendingSilverGold), whose months are written in the procedures; this schedule is used for the levels those jobs
-- do not know (SectionTypes rows that are certification levels other than Bronze / Silver / Gold).
--
--   dbo.SectionTypes, new columns (NULL = the Silver / Gold value in brackets):
--     SurveillanceCount              surveillances during the certificate's validity (2)
--     SurveillanceIntervalMonths     months between two surveillance due dates (12)
--     SurveillanceNoticeMonths       months before a due date the "apply for surveillance" mail goes (4)
--     SurveillanceReminders          reminders after that mail (2)
--     SurveillanceReminderEveryMonths  months between the mail and each reminder (1)
--     SurveillanceSuspendAfterMonths months after a due date an unapplied certificate is suspended (1)
--     SurveillanceWithdrawAfterDays  days after the suspension a still unapplied certificate is withdrawn (64)
--     (the first due date is FirstSurveillanceMonths after certification, migration 0028; Silver / Gold: 15)
--   dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE [@Today], [@Level]: run daily by Zed.Jobs ("Level surveillance schedule").
--     For each certified record (status 16) of such a level with surveillance on, round r = 1..SurveillanceCount is due
--     FirstSurveillanceMonths + (r - 1) * SurveillanceIntervalMonths after the certification date, and:
--       - the notice (from due - SurveillanceNoticeMonths): MsmeCertifications.EnableSurveillance1 = r, AutoMailSend =
--         (r - 1) * 10 + 1, the unit copied to ZED_SURVEILLANCE (SP_V4_SURVEILLANCE_COPY_UNIT, migration 0033) so it can
--         pay; for r > 1, as the legacy second-surveillance job: Msme.IsSur{Level}PaymentDone and the surveillance
--         database's payment flag cleared, ReSurveillance = 1 there (its payment procedure then archives round r - 1);
--       - reminder k (every SurveillanceReminderEveryMonths after the notice): AutoMailSend = (r - 1) * 10 + 1 + k;
--       - suspension (from due + SurveillanceSuspendAfterMonths, not applied, ACTIVE): CertificationPhase SUSPENDED,
--         benefits off, SurveillanceAutoMailHistory 'SUSPENSION' (the surveillance certification sets ACTIVE again);
--       - withdrawal (SurveillanceWithdrawAfterDays after that suspension, still not applied): WITHDRAWN.
--     "Applied" = the level's surveillance payment flag (Msme.IsSur{Level}PaymentDone) for the current round.
--     Each step sends its mail (no password) through dbo.SP_V4_SEND_DBMAIL when migration 0003 is in, else Database
--     Mail; the Admin can switch them off or change them (Email Templates, "db:SP_V4_LEVEL_SURVEILLANCE_SCHEDULE").
--     Expiry first: a certificate of such a level (surveillance on or not) is EXPIRED once its validity (the Admin's
--     ValidityMonths, migration 0028) has run out; the legacy Certificate_Expiry job knows Bronze / Silver / Gold (3 years)
--     only. ZED-X is a separate track: the unit's benefits flag is left to its other certificates.
--     @Today lets a check run the schedule for another day; @Level limits it to one level.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceCount') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceCount int NULL;
IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceIntervalMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceIntervalMonths int NULL;
IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceNoticeMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceNoticeMonths int NULL;
IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceReminders') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceReminders int NULL;
IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceReminderEveryMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceReminderEveryMonths int NULL;
IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceSuspendAfterMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceSuspendAfterMonths int NULL;
IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceWithdrawAfterDays') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceWithdrawAfterDays int NULL;
GO
-- ZED-X starts with the Silver / Gold schedule (two surveillances; the first due 15 months after certification).
IF COL_LENGTH('dbo.SectionTypes', 'IsCertificationLevel') IS NOT NULL
    EXEC (N'
    UPDATE dbo.SectionTypes SET SurveillanceCount = 2, SurveillanceIntervalMonths = 12, SurveillanceNoticeMonths = 4, SurveillanceReminders = 2,
        SurveillanceReminderEveryMonths = 1, SurveillanceSuspendAfterMonths = 1, SurveillanceWithdrawAfterDays = 64,
        FirstSurveillanceMonths = CASE WHEN FirstSurveillanceMonths IS NULL OR FirstSurveillanceMonths = 12 THEN 15 ELSE FirstSurveillanceMonths END
    WHERE SectionType = ''ZEDX'' AND SurveillanceCount IS NULL;');
GO
-- The parameters assessed in surveillance (Sections.SurveMandatories = 'Yes', as Gold's; the surveillance payment copies
-- only those): a V4 level with none marked has all of them marked, so that its surveillance is never empty. The Admin
-- then chooses them in the Questionnaire (Admin -> Questionnaire, "Assessed in surveillance").
IF COL_LENGTH('dbo.SectionTypes', 'IsCertificationLevel') IS NOT NULL AND COL_LENGTH('dbo.Sections', 'SurveMandatories') IS NOT NULL
    EXEC (N'
    UPDATE S SET SurveMandatories = ''Yes''
    FROM dbo.Sections S JOIN dbo.SectionTypes T ON T.SectionType = S.SectionType
    WHERE T.IsCertificationLevel = 1 AND T.SectionType NOT IN (''Bronze'', ''Silver'', ''Gold'')
      AND NOT EXISTS (SELECT 1 FROM dbo.Sections M WHERE M.SectionType = S.SectionType AND M.SurveMandatories = ''Yes'');');
GO
-- The surveillance fee flag of ZED-X on main exists since migration 0029 (Msme.IsSurZEDXPaymentDone).
IF COL_LENGTH('dbo.Msme', 'IsSurZEDXPaymentDone') IS NULL ALTER TABLE dbo.Msme ADD IsSurZEDXPaymentDone bit NULL;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_SURVEILLANCE_MAIL
    @To varchar(200),
    @Subject nvarchar(255),
    @Body nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    IF NULLIF(LTRIM(RTRIM(@To)), '') IS NULL RETURN;
    BEGIN TRY
        IF OBJECT_ID('dbo.SP_V4_SEND_DBMAIL', 'P') IS NOT NULL
            EXEC dbo.SP_V4_SEND_DBMAIL @profile_name = 'ZedAdmin', @recipients = @To, @subject = @Subject, @body = @Body,
                @body_format = 'HTML', @source = N'SP_V4_LEVEL_SURVEILLANCE_SCHEDULE';
        ELSE
            EXEC msdb.dbo.sp_send_dbmail @profile_name = 'ZedAdmin', @recipients = @To, @subject = @Subject, @body = @Body, @body_format = 'HTML';
    END TRY
    BEGIN CATCH
        -- A mail that cannot go (no Database Mail on SQL Express before 0003) never stops the schedule.
        PRINT CONCAT('Surveillance mail to ', @To, ' not sent: ', ERROR_MESSAGE());
    END CATCH
END
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE
    @Today date = NULL,
    @Level varchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @d date = ISNULL(@Today, CAST(GETDATE() AS date));
    -- When the steps are recorded: now, or the day a check runs the schedule for (the withdrawal counts from it).
    DECLARE @now datetime = CASE WHEN @Today IS NULL THEN GETDATE() ELSE CAST(@d AS datetime) END;
    DECLARE @Scheme nvarchar(100) = N'“MSME Sustainable (ZED) Certification” Scheme';

    -- Expiry of the V4 levels' certificates.
    DECLARE @Expired TABLE (ZedId varchar(50), Certification varchar(50));
    UPDATE C SET CertificationPhase = 'EXPIRED'
    OUTPUT inserted.ZedId, inserted.Certification INTO @Expired
    FROM dbo.MsmeCertifications C JOIN dbo.SectionTypes T ON T.SectionType = C.Certification
    WHERE T.IsCertificationLevel = 1 AND T.SectionType NOT IN ('Bronze', 'Silver', 'Gold') AND (@Level IS NULL OR T.SectionType = @Level)
      AND ((C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL) OR (C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL AND T.AssessmentMode = 'Desktop'))
      AND C.CertificationStatusDate IS NOT NULL AND C.CertificationStatusDate <= DATEADD(MONTH, -ISNULL(T.ValidityMonths, 36), @now)
      AND ISNULL(C.CertificationPhase, 'ACTIVE') NOT IN ('EXPIRED', 'WITHDRAWN') AND C.ZedId NOT LIKE '%[_]%';
    INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
    SELECT ZedId, CONCAT(N'Certificate expired on ', FORMAT(@now, 'MMMM d, yyyy')), @now, Certification, 'Expired' FROM @Expired;

    -- The levels on this schedule and their settings.
    DECLARE @Levels TABLE (Code varchar(50) PRIMARY KEY, Name nvarchar(100), First int, Cnt int, Interval int, Notice int, Rem int, RemEvery int,
        Suspend int, Withdraw int);
    INSERT INTO @Levels
    SELECT SectionType, ISNULL(DisplayName, SectionType), ISNULL(FirstSurveillanceMonths, 15), ISNULL(SurveillanceCount, 2),
        ISNULL(SurveillanceIntervalMonths, 12), ISNULL(SurveillanceNoticeMonths, 4), ISNULL(SurveillanceReminders, 2),
        ISNULL(SurveillanceReminderEveryMonths, 1), ISNULL(SurveillanceSuspendAfterMonths, 1), ISNULL(SurveillanceWithdrawAfterDays, 64)
    FROM dbo.SectionTypes
    WHERE IsCertificationLevel = 1 AND ISNULL(SurveillanceEnabled, 0) = 1 AND SectionType NOT IN ('Bronze', 'Silver', 'Gold')
      AND (@Level IS NULL OR SectionType = @Level) AND SectionType NOT LIKE '%[^A-Za-z0-9]%';

    -- Every certified record of those levels, with its current round.
    DECLARE @Work TABLE (ZedId varchar(50), Certification varchar(50), CertDate date, Phase varchar(50), Mail int, Round int,
        Email varchar(200), UnitName nvarchar(300), Paid bit);
    DECLARE @code varchar(50);
    DECLARE lv CURSOR LOCAL FAST_FORWARD FOR SELECT Code FROM @Levels;
    OPEN lv; FETCH NEXT FROM lv INTO @code;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- The payment flag column is named after the level (Msme.IsSur{Level}PaymentDone): read through dynamic SQL.
        IF COL_LENGTH('dbo.Msme', 'IsSur' + @code + 'PaymentDone') IS NOT NULL
        BEGIN
            DECLARE @q nvarchar(max) = N'
            SELECT C.ZedId, C.Certification, CAST(C.CertificationStatusDate AS date), ISNULL(C.CertificationPhase, ''ACTIVE''), ISNULL(C.AutoMailSend, 0),
                   ISNULL(C.EnableSurveillance1, 0), NULLIF(LTRIM(RTRIM(ISNULL(NULLIF(M.EmailId, ''''), M.PledgeEmailId))), ''''), M.PUnitName,
                   CAST(ISNULL(M.' + QUOTENAME('IsSur' + @code + 'PaymentDone') + N', 0) AS bit)
            FROM dbo.MsmeCertifications C JOIN dbo.Msme M ON M.ZedId = C.ZedId
            WHERE C.Certification = @c AND C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL AND C.CertificationStatusDate IS NOT NULL
              AND ISNULL(C.CertificationPhase, ''ACTIVE'') IN (''ACTIVE'', ''SUSPENDED'') AND C.ZedId NOT LIKE ''%[_]%'';';
            INSERT INTO @Work EXEC sp_executesql @q, N'@c varchar(50)', @c = @code;
        END
        FETCH NEXT FROM lv INTO @code;
    END
    CLOSE lv; DEALLOCATE lv;

    DECLARE @ZedId varchar(50), @Cert varchar(50), @CertDate date, @Phase varchar(50), @Mail int, @Round int, @Email varchar(200),
        @Unit nvarchar(300), @Paid bit, @Name nvarchar(100), @First int, @Cnt int, @Interval int, @Notice int, @Rem int, @RemEvery int,
        @Suspend int, @Withdraw int, @r int, @due date, @k int, @subject nvarchar(255), @body nvarchar(max), @step int, @sql nvarchar(max);
    DECLARE w CURSOR LOCAL FAST_FORWARD FOR
        SELECT W.ZedId, W.Certification, W.CertDate, W.Phase, W.Mail, W.Round, W.Email, W.UnitName, W.Paid,
               L.Name, L.First, L.Cnt, L.Interval, L.Notice, L.Rem, L.RemEvery, L.Suspend, L.Withdraw
        FROM @Work W JOIN @Levels L ON L.Code = W.Certification ORDER BY W.CertDate;
    OPEN w;
    FETCH NEXT FROM w INTO @ZedId, @Cert, @CertDate, @Phase, @Mail, @Round, @Email, @Unit, @Paid, @Name, @First, @Cnt, @Interval, @Notice, @Rem,
        @RemEvery, @Suspend, @Withdraw;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @step = NULL; SET @subject = NULL;
        -- The round in hand: the current one, or the next once the current is applied for and its notice time has come.
        SET @r = CASE WHEN @Round < 1 THEN 1 ELSE @Round END;
        IF @Round >= 1 AND @Paid = 1 AND @r < @Cnt
           AND @d >= DATEADD(MONTH, -@Notice, DATEADD(MONTH, @First + @r * @Interval, @CertDate))
            SET @r = @r + 1;
        SET @due = DATEADD(MONTH, @First + (@r - 1) * @Interval, @CertDate);

        IF @r <= @Cnt
        BEGIN
            IF @r <> @Round AND @d >= DATEADD(MONTH, -@Notice, @due)
                SET @step = 1;                                                     -- notice of round @r
            ELSE IF @r = @Round AND @Paid = 0
            BEGIN
                -- The reminders still due (one per run, oldest first).
                SET @k = @Mail - ((@r - 1) * 10 + 1) + 1;
                IF @k >= 1 AND @k <= @Rem AND @d >= DATEADD(MONTH, @k * @RemEvery, DATEADD(MONTH, -@Notice, @due))
                    SET @step = 2;
                ELSE IF @Phase = 'ACTIVE' AND @d >= DATEADD(MONTH, @Suspend, @due)
                    SET @step = 3;                                                 -- suspension
                ELSE IF @Phase = 'SUSPENDED' AND EXISTS (
                    SELECT 1 FROM dbo.SurveillanceAutoMailHistory H WHERE H.ZedId = @ZedId AND H.Certification = @Cert
                      AND H.MailType = 'SUSPENSION' AND ISNULL(H.SurveillanceNo, 1) = @r
                      AND DATEADD(DAY, @Withdraw, CAST(H.CreatedDate AS date)) <= @d)
                    SET @step = 4;                                                 -- withdrawal
            END
        END

        BEGIN TRY
            BEGIN TRANSACTION;
            IF @step = 1
            BEGIN
                UPDATE dbo.MsmeCertifications SET EnableSurveillance1 = @r, AutoMailSend = (@r - 1) * 10 + 1,
                    FirstSurveDueDate = CASE WHEN @r = 1 THEN @due ELSE FirstSurveDueDate END,
                    SecondSurveDueDate = CASE WHEN @r = 2 THEN @due ELSE SecondSurveDueDate END
                WHERE ZedId = @ZedId AND Certification = @Cert;
                UPDATE dbo.MsmeBasicInformation SET SurvCertificationLevel = @Cert WHERE ZedId = @ZedId;
                IF @r > 1
                BEGIN
                    SET @sql = N'UPDATE dbo.Msme SET ' + QUOTENAME('IsSur' + @Cert + 'PaymentDone') + N' = NULL WHERE ZedId = @z;';
                    EXEC sp_executesql @sql, N'@z varchar(50)', @z = @ZedId;
                END
                IF OBJECT_ID('ZED_SURVEILLANCE.dbo.SP_V4_SURVEILLANCE_COPY_UNIT', 'P') IS NOT NULL
                    EXEC ZED_SURVEILLANCE.dbo.SP_V4_SURVEILLANCE_COPY_UNIT @ZedId = @ZedId, @Certification = @Cert, @Round = @r;
                SET @subject = CASE WHEN @r = 1 THEN N'Apply for Surveillance Assessment under ' ELSE CONCAT(N'Apply for Surveillance ', @r, N' Assessment under ') END
                    + @Scheme + N' - ' + @ZedId;
                SET @body = CONCAT(N'<p>Dear Madam/Sir,<br>Greetings of the day!</p><p>This is with reference to your ', @Name,
                    N' certification under ', @Scheme, N'. As per the scheme guidelines, surveillance assessment ', @r, N' of your certificate is due by <b>',
                    FORMAT(@due, 'MMM dd yyyy'), N'</b>.</p><p>The surveillance assessment is mandatory for continuation of the certification. ',
                    N'Failure to do so will lead to suspension/withdrawal of the certification.</p><p>Please sign in to the ZED portal with your ZED ID <b>',
                    @ZedId, N'</b> and apply for the surveillance assessment from your dashboard.</p><p>Unit: ', @Unit, N'</p><p>Thanks and Regards,<br>ZED Team</p>');
                INSERT INTO dbo.SurveillanceAutoMailHistory (ZedId, Certification, CertificationStatusDate, CreatedDate, RecipientEmail, UnitName, MailNumber, MailType, SurveillanceNo)
                VALUES (@ZedId, @Cert, @CertDate, @now, @Email, @Unit, 1, 'APPLY', @r);
            END
            ELSE IF @step = 2
            BEGIN
                UPDATE dbo.MsmeCertifications SET AutoMailSend = @Mail + 1 WHERE ZedId = @ZedId AND Certification = @Cert;
                SET @subject = CONCAT(N'Reminder ', @k, N': Apply for Surveillance Assessment under ', @Scheme, N' - ', @ZedId);
                SET @body = CONCAT(N'<p>Dear Madam/Sir,<br>Greetings of the day!</p><p>This is a reminder that surveillance assessment ', @r,
                    N' of your ', @Name, N' certification is due by <b>', FORMAT(@due, 'MMM dd yyyy'),
                    N'</b>. Please sign in to the ZED portal with your ZED ID <b>', @ZedId, N'</b> and apply for it from your dashboard. ',
                    N'Failure to do so will lead to suspension/withdrawal of the certification.</p><p>Thanks and Regards,<br>ZED Team</p>');
                INSERT INTO dbo.SurveillanceAutoMailHistory (ZedId, Certification, CertificationStatusDate, CreatedDate, RecipientEmail, UnitName, MailNumber, MailType, SurveillanceNo)
                VALUES (@ZedId, @Cert, @CertDate, @now, @Email, @Unit, @k + 1, 'REMINDER', @r);
            END
            ELSE IF @step = 3
            BEGIN
                UPDATE dbo.MsmeCertifications SET CertificationPhase = 'SUSPENDED' WHERE ZedId = @ZedId AND Certification = @Cert;
                UPDATE dbo.MsmeBasicInformation SET IsEligibleForBenefits = 0 WHERE ZedId = @ZedId AND IsEligibleForBenefits = 1;
                SET @subject = CONCAT(N'Suspension of Certification under ', @Scheme, N' - ', @ZedId);
                SET @body = CONCAT(N'<p>Dear Madam/Sir,<br>Greetings of the day!</p><p>Surveillance assessment ', @r, N' of your ', @Name,
                    N' certification was due by ', FORMAT(@due, 'MMM dd yyyy'), N' and has not been applied for. Your certification is therefore <b>suspended</b>.</p>',
                    N'<p>To revoke the suspension, apply for and complete the surveillance assessment within ', @Withdraw,
                    N' days. Failure to do so will lead to withdrawal of the certification.</p><p>Thanks and Regards,<br>ZED Team</p>');
                INSERT INTO dbo.SurveillanceAutoMailHistory (ZedId, Certification, CertificationStatusDate, CreatedDate, RecipientEmail, UnitName, MailNumber, MailType, SurveillanceNo)
                VALUES (@ZedId, @Cert, @CertDate, @now, @Email, @Unit, 1, 'SUSPENSION', @r);
            END
            ELSE IF @step = 4
            BEGIN
                UPDATE dbo.MsmeCertifications SET CertificationPhase = 'WITHDRAWN' WHERE ZedId = @ZedId AND Certification = @Cert;
                UPDATE dbo.MsmeBasicInformation SET IsEligibleForBenefits = 0 WHERE ZedId = @ZedId AND IsEligibleForBenefits = 1;
                SET @subject = CONCAT(N'Withdrawal of Certification under ', @Scheme, N' - ', @ZedId);
                SET @body = CONCAT(N'<p>Dear Madam/Sir,<br>Greetings of the day!</p><p>Surveillance assessment ', @r, N' of your ', @Name,
                    N' certification has not been completed after the suspension. Your certification is therefore <b>withdrawn</b>.</p>',
                    N'<p>Thanks and Regards,<br>ZED Team</p>');
                INSERT INTO dbo.SurveillanceAutoMailHistory (ZedId, Certification, CertificationStatusDate, CreatedDate, RecipientEmail, UnitName, MailNumber, MailType, SurveillanceNo)
                VALUES (@ZedId, @Cert, @CertDate, @now, @Email, @Unit, 1, 'WITHDRAWAL', @r);
            END
            IF @step IS NOT NULL
                INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
                VALUES (@ZedId, CONCAT(CASE @step WHEN 1 THEN N'Surveillance ' + CAST(@r AS nvarchar(3)) + N' opened, due ' + FORMAT(@due, 'MMMM d, yyyy')
                                                  WHEN 2 THEN N'Surveillance ' + CAST(@r AS nvarchar(3)) + N' reminder ' + CAST(@k AS nvarchar(3))
                                                  WHEN 3 THEN N'Suspended: surveillance ' + CAST(@r AS nvarchar(3)) + N' not applied for'
                                                  ELSE N'Withdrawn: surveillance ' + CAST(@r AS nvarchar(3)) + N' not completed' END, N' on ', FORMAT(@now, 'MMMM d, yyyy')),
                        @now, @Cert, CASE @step WHEN 1 THEN 'SurveillanceOpened' WHEN 2 THEN 'SurveillanceReminder' WHEN 3 THEN 'Suspended' ELSE 'Withdrawn' END);
            COMMIT;
            IF @subject IS NOT NULL EXEC dbo.SP_V4_SURVEILLANCE_MAIL @To = @Email, @Subject = @subject, @Body = @body;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            PRINT CONCAT('Surveillance schedule of ', @ZedId, ' ', @Cert, ' failed: ', ERROR_MESSAGE());
        END CATCH

        FETCH NEXT FROM w INTO @ZedId, @Cert, @CertDate, @Phase, @Mail, @Round, @Email, @Unit, @Paid, @Name, @First, @Cnt, @Interval, @Notice, @Rem,
            @RemEvery, @Suspend, @Withdraw;
    END
    CLOSE w; DEALLOCATE w;
END
GO
