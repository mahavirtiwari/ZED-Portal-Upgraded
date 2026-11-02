-- Run on ZEDCS_V2_LIVE only. Safe to re-run. Needs 0037: it replaces 0037's SP_V4_LEVEL_SURVEILLANCE_SCHEDULE (0037 runs
-- before it in deploy\Invoke-ZedDatabaseScripts.ps1, so running both again leaves this version).
-- Two corrections of the V4 surveillance schedule (Zed.Jobs "Level surveillance schedule", docs/JOBS.md):
--   1. A paid unit stays on the schedule. The ZED_SURVEILLANCE payment procedures (gateway, manual and zero payment) set
--      main's MsmeCertifications.RestrictMail = 'Payment Completed' (round 2: 'S2 Payment Completed'), and 0037 read only
--      units with RestrictMail NULL, so Silver / Gold surveillance 2 (and a later ZED-X round) never opened after a real
--      payment. As in the legacy second-round job (SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL, which does not look
--      at RestrictMail), those two values no longer leave a unit out; the upgrade values ('Silver Certified', 'Gold
--      Certified', set with CertificationPhase UPGRADED) still do.
--   2. A step whose day came before the level's start (SurveillanceScheduleFrom) no longer stops the unit. 0037 left it as
--      it was, and because a unit's steps go one at a time, oldest first, every later step of that unit (its reminders,
--      its suspension, Bronze's apply by the portal) waited for ever. Its mail is still not sent, but a notice now opens
--      the round, a reminder is counted, and the portal's apply is counted without applying the unit; then the unit's next
--      step is looked at in the same run (done when its day has come and is not before the start). A suspension or a
--      withdrawal before the start is still not done. Each step passed over is written to MsmeHistory ("no mail: its day,
--      ..., was before the V4 schedule started") and listed by the dry run with a note.
-- Nothing else changes: the timings, the mails and the steps on or after the start are 0037's.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE
    @Today date = NULL,
    @Level varchar(50) = NULL,
    -- 1: nothing is changed or mailed; the steps the run would take are returned as one result set, those whose date is
    -- before the level's start with a note (passed over without their mail, or not done).
    @DryRun bit = 0,
    -- 1: the switch-over. Bronze / Silver / Gold (start day 9999-12-31) wait until this is run once, on the day the legacy
    -- SQL Agent jobs are switched off; the daily run never starts them by itself.
    @Start bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @d date = ISNULL(@Today, CAST(GETDATE() AS date));
    -- When the steps are recorded: now, or the day a check runs the schedule for (the withdrawal counts from it).
    DECLARE @now datetime = CASE WHEN @Today IS NULL THEN GETDATE() ELSE CAST(@d AS datetime) END;
    DECLARE @Scheme nvarchar(100) = N'“MSME Sustainable (ZED) Certification” Scheme';
    DECLARE @Plan TABLE (ZedId varchar(50), Certification varchar(50), Round int, Step varchar(30), StepDate date, Due date, Note nvarchar(200));

    -- Expiry of the V4 levels' certificates (Bronze / Silver / Gold: the legacy Certificate_Expiry job, unchanged).
    IF @DryRun = 0
    BEGIN
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

        -- The switch-over: the day the levels started (no catching up on steps before it).
        IF @Start = 1
            UPDATE dbo.SectionTypes SET SurveillanceScheduleFrom = @d
            WHERE SurveillanceScheduleFrom = '9999-12-31' AND IsCertificationLevel = 1 AND ISNULL(SurveillanceEnabled, 0) = 1
              AND (@Level IS NULL OR SectionType = @Level);
    END

    -- The levels on this schedule and their settings.
    DECLARE @Levels TABLE (Code varchar(50) PRIMARY KEY, Name nvarchar(100), First int, Cnt int, Interval int, Notice int, Rem int, RemEvery int,
        Suspend int, Withdraw int, AutoApply bit, SuspendRounds int, StartFrom date, Desktop bit, OrderNo int, Legacy bit);
    INSERT INTO @Levels
    SELECT SectionType, ISNULL(DisplayName, SectionType), ISNULL(FirstSurveillanceMonths, 15), ISNULL(SurveillanceCount, 2),
        ISNULL(SurveillanceIntervalMonths, 12), ISNULL(SurveillanceNoticeMonths, 4), ISNULL(SurveillanceReminders, 2),
        ISNULL(SurveillanceReminderEveryMonths, 1), ISNULL(SurveillanceSuspendAfterMonths, 1), ISNULL(SurveillanceWithdrawAfterDays, 64),
        -- The portal applies only for Bronze's surveillance: the legacy Bronze procedure records it as a zero payment on
        -- the coupon fee row without checking the amount, which is right for Bronze only.
        CASE WHEN SectionType = 'Bronze' AND AssessmentMode = 'Desktop' THEN ISNULL(SurveillanceAutoApply, 0) ELSE 0 END, SurveillanceSuspendRounds,
        -- A dry run before the first one: as if it started on its day.
        CASE WHEN SurveillanceScheduleFrom = '9999-12-31' THEN @d ELSE SurveillanceScheduleFrom END,
        CASE WHEN AssessmentMode = 'Desktop' THEN 1 ELSE 0 END, ISNULL(OrderNo, 0),
        CASE WHEN SectionType IN ('Bronze', 'Silver', 'Gold') THEN 1 ELSE 0 END
    FROM dbo.SectionTypes
    WHERE IsCertificationLevel = 1 AND ISNULL(SurveillanceEnabled, 0) = 1
      AND (@Level IS NULL OR SectionType = @Level) AND SectionType NOT LIKE '%[^A-Za-z0-9]%'
      -- A level not started yet (Bronze / Silver / Gold before the switch-over) is left to the legacy jobs; a dry run shows it.
      AND (ISNULL(SurveillanceScheduleFrom, '19000101') <> '9999-12-31' OR @DryRun = 1);

    -- Every certified record of those levels, with its current round: site levels certified at 16 with the site certificate,
    -- desktop levels (Bronze) at 6 with the desktop certificate. Not a unit the portal stopped mailing (RestrictMail, set by an
    -- upgrade), nor one certified since at a higher level (as the legacy jobs: Bronze after Silver / Gold, Silver after Gold).
    -- The surveillance payment procedures of ZED_SURVEILLANCE set RestrictMail too ('Payment Completed', round 2 'S2 Payment
    -- Completed'): those units stay on the schedule, or the next round would never open after a paid one (the legacy
    -- second-round job did not look at RestrictMail).
    DECLARE @Work TABLE (ZedId varchar(50), Certification varchar(50), CertDate date, Phase varchar(50), Mail int, Round int,
        Email varchar(200), UnitName nvarchar(300), Paid bit);
    DECLARE @code varchar(50), @desktop bit, @order int;
    DECLARE lv CURSOR LOCAL FAST_FORWARD FOR SELECT Code, Desktop, OrderNo FROM @Levels;
    OPEN lv; FETCH NEXT FROM lv INTO @code, @desktop, @order;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- The payment flag column is named after the level (Msme.IsSur{Level}PaymentDone): read through dynamic SQL.
        IF COL_LENGTH('dbo.Msme', 'IsSur' + @code + 'PaymentDone') IS NOT NULL
        BEGIN
            DECLARE @q nvarchar(max) = N'
            SELECT C.ZedId, C.Certification, CAST(C.CertificationStatusDate AS date), ISNULL(C.CertificationPhase, ''ACTIVE''),
                   -- The legacy second-round mail numbers 4 / 5 / 6 are this schedule''s 11 / 12 / 13.
                   CASE WHEN ISNULL(C.EnableSurveillance1, 0) = 2 AND C.AutoMailSend IN (4, 5, 6) THEN C.AutoMailSend + 7 ELSE ISNULL(C.AutoMailSend, 0) END,
                   ISNULL(C.EnableSurveillance1, 0), NULLIF(LTRIM(RTRIM(ISNULL(NULLIF(M.EmailId, ''''), M.PledgeEmailId))), ''''), M.PUnitName,
                   CAST(ISNULL(M.' + QUOTENAME('IsSur' + @code + 'PaymentDone') + N', 0) AS bit)
            FROM dbo.MsmeCertifications C JOIN dbo.Msme M ON M.ZedId = C.ZedId
            WHERE C.Certification = @c AND C.CertificationStatusDate IS NOT NULL
              AND ((@desktop = 0 AND C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL)
                OR (@desktop = 1 AND C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL))
              AND ISNULL(C.CertificationPhase, ''ACTIVE'') IN (''ACTIVE'', ''SUSPENDED'') AND C.ZedId NOT LIKE ''%[_]%''
              AND (C.RestrictMail IS NULL OR C.RestrictMail IN (''Payment Completed'', ''S2 Payment Completed''))
              AND NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications X JOIN dbo.SectionTypes TX ON TX.SectionType = X.Certification
                              WHERE X.ZedId = C.ZedId AND TX.IsCertificationLevel = 1 AND ISNULL(TX.OrderNo, 0) > @o AND X.CertificationStatus = 16);';
            INSERT INTO @Work EXEC sp_executesql @q, N'@c varchar(50), @desktop bit, @o int', @c = @code, @desktop = @desktop, @o = @order;
        END
        FETCH NEXT FROM lv INTO @code, @desktop, @order;
    END
    CLOSE lv; DEALLOCATE lv;

    DECLARE @ZedId varchar(50), @Cert varchar(50), @CertDate date, @Phase varchar(50), @Mail int, @Round int, @Email varchar(200),
        @Unit nvarchar(300), @Paid bit, @Name nvarchar(100), @First int, @Cnt int, @Interval int, @Notice int, @Rem int, @RemEvery int,
        @Suspend int, @Withdraw int, @AutoApply bit, @SuspendRounds int, @StartFrom date, @Legacy bit, @Desk bit,
        @r int, @due date, @k int, @subject nvarchar(255), @body nvarchar(max), @step int, @stepDate date, @sql nvarchar(max), @note nvarchar(200),
        @silent bit, @failed bit, @pass int;
    DECLARE w CURSOR LOCAL FAST_FORWARD FOR
        SELECT W.ZedId, W.Certification, W.CertDate, W.Phase, W.Mail, W.Round, W.Email, W.UnitName, W.Paid,
               L.Name, L.First, L.Cnt, L.Interval, L.Notice, L.Rem, L.RemEvery, L.Suspend, L.Withdraw, L.AutoApply, L.SuspendRounds, L.StartFrom,
               L.Legacy, L.Desktop
        FROM @Work W JOIN @Levels L ON L.Code = W.Certification ORDER BY W.CertDate;
    OPEN w;
    FETCH NEXT FROM w INTO @ZedId, @Cert, @CertDate, @Phase, @Mail, @Round, @Email, @Unit, @Paid, @Name, @First, @Cnt, @Interval, @Notice, @Rem,
        @RemEvery, @Suspend, @Withdraw, @AutoApply, @SuspendRounds, @StartFrom, @Legacy, @Desk;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @pass = 0; SET @failed = 0;
        -- One step per unit and run; a step whose day came before the level's start is passed over and the unit's next
        -- step looked at in the same run (bounded, in case of a loop).
        WHILE @pass < 50
        BEGIN
            SET @pass += 1;
            SET @step = NULL; SET @subject = NULL; SET @stepDate = NULL; SET @note = NULL; SET @silent = 0;
            -- The round in hand: the current one, or the next once the current is applied for and its notice time has come
            -- (and, from the second round on, the earlier round was certified at least 3 months before, as the legacy job).
            SET @r = CASE WHEN @Round < 1 THEN 1 ELSE @Round END;
            IF @Round >= 1 AND @Paid = 1 AND @r < @Cnt
               AND @d >= DATEADD(MONTH, -@Notice, DATEADD(MONTH, @First + @r * @Interval, @CertDate))
               AND EXISTS (SELECT 1 FROM (SELECT TOP (1) S.CertificationStatus, S.CertificationStatusDate FROM ZED_SURVEILLANCE.dbo.MsmeCertifications S
                                          WHERE S.ZedId = @ZedId AND S.Certification = @Cert ORDER BY S.Id DESC) L
                           WHERE L.CertificationStatus = 16 AND L.CertificationStatusDate <= DATEADD(MONTH, -3, @now))
                SET @r = @r + 1;
            SET @due = DATEADD(MONTH, @First + (@r - 1) * @Interval, @CertDate);

            IF @r <= @Cnt
            BEGIN
                IF @r <> @Round AND @d >= DATEADD(MONTH, -@Notice, @due)
                    SELECT @step = 1, @stepDate = DATEADD(MONTH, -@Notice, @due);       -- notice of round @r
                ELSE IF @r = @Round AND @Paid = 0
                BEGIN
                    -- The reminders still due (one per run, oldest first); with auto-apply, the last one applies the unit.
                    SET @k = @Mail - ((@r - 1) * 10 + 1) + 1;
                    IF @k >= 1 AND @k <= @Rem AND @d >= DATEADD(MONTH, @k * @RemEvery, DATEADD(MONTH, -@Notice, @due))
                        SELECT @step = CASE WHEN @AutoApply = 1 AND @k = @Rem THEN 5 ELSE 2 END,
                               @stepDate = DATEADD(MONTH, @k * @RemEvery, DATEADD(MONTH, -@Notice, @due));
                    ELSE IF @Phase = 'ACTIVE' AND @d >= DATEADD(MONTH, @Suspend, @due) AND (@SuspendRounds IS NULL OR @r <= @SuspendRounds)
                        SELECT @step = 3, @stepDate = DATEADD(MONTH, @Suspend, @due);   -- suspension
                    ELSE IF @Phase = 'SUSPENDED' AND (@SuspendRounds IS NULL OR @r <= @SuspendRounds)
                    BEGIN
                        SELECT @stepDate = DATEADD(DAY, @Withdraw, CAST(MAX(H.CreatedDate) AS date)) FROM dbo.SurveillanceAutoMailHistory H
                        WHERE H.ZedId = @ZedId AND H.Certification = @Cert AND H.MailType = 'SUSPENSION' AND ISNULL(H.SurveillanceNo, 1) = @r;
                        IF @stepDate IS NOT NULL AND @stepDate <= @d SET @step = 4;     -- withdrawal
                    END
                END
            END

            IF @step IS NULL BREAK;

            -- No catching up on a step whose day came before the level's start: its mail is not sent. A notice or a reminder
            -- moves the unit on without it (the round is opened, the reminder counted), and so does the portal's apply (counted,
            -- the unit NOT applied for), so the steps after it still come in their time; a suspension or a withdrawal is not
            -- done. The dry run lists each of them with its note.
            IF @StartFrom IS NOT NULL AND @stepDate < @StartFrom
                SELECT @silent = CASE WHEN @step IN (1, 2, 5) THEN 1 ELSE 0 END,
                       @note = CASE WHEN @step IN (3, 4) THEN N'Before the V4 schedule started: not done.'
                                    WHEN @step = 5 THEN N'Before the V4 schedule started: not applied, no mail; the next steps follow.'
                                    ELSE N'Before the V4 schedule started: no mail; the next steps follow.' END;
            INSERT INTO @Plan VALUES (@ZedId, @Cert, @r, CASE @step WHEN 1 THEN 'Notice' WHEN 2 THEN 'Reminder' WHEN 3 THEN 'Suspension'
                WHEN 4 THEN 'Withdrawal' ELSE 'Auto-apply' END, @stepDate, @due, @note);
            IF @note IS NOT NULL AND @silent = 0 BREAK;

            IF @DryRun = 0
            BEGIN TRY
                BEGIN TRANSACTION;
                IF @step = 1
                BEGIN
                    -- The legacy levels keep the due dates set when they were certified.
                    UPDATE dbo.MsmeCertifications SET EnableSurveillance1 = @r, AutoMailSend = (@r - 1) * 10 + 1,
                        FirstSurveDueDate = CASE WHEN @r = 1 AND (@Legacy = 0 OR FirstSurveDueDate IS NULL) THEN @due ELSE FirstSurveDueDate END,
                        SecondSurveDueDate = CASE WHEN @r = 2 AND (@Legacy = 0 OR SecondSurveDueDate IS NULL) THEN @due ELSE SecondSurveDueDate END
                    WHERE ZedId = @ZedId AND Certification = @Cert;
                    UPDATE dbo.MsmeBasicInformation SET SurvCertificationLevel = @Cert WHERE ZedId = @ZedId;
                    IF @r > 1
                    BEGIN
                        SET @sql = N'UPDATE dbo.Msme SET ' + QUOTENAME('IsSur' + @Cert + 'PaymentDone') + N' = NULL WHERE ZedId = @z;';
                        EXEC sp_executesql @sql, N'@z varchar(50)', @z = @ZedId;
                    END
                    IF OBJECT_ID('ZED_SURVEILLANCE.dbo.SP_V4_SURVEILLANCE_COPY_UNIT', 'P') IS NOT NULL
                        EXEC ZED_SURVEILLANCE.dbo.SP_V4_SURVEILLANCE_COPY_UNIT @ZedId = @ZedId, @Certification = @Cert, @Round = @r;
                    IF @silent = 0
                    BEGIN
                        SET @subject = CASE WHEN @r = 1 THEN N'Apply for Surveillance Assessment under ' ELSE CONCAT(N'Apply for Surveillance ', @r, N' Assessment under ') END
                            + @Scheme + N' - ' + @ZedId;
                        SET @body = CONCAT(N'<p>Dear Madam/Sir,<br>Greetings of the day!</p><p>This is with reference to your ', @Name,
                            N' certification under ', @Scheme, N'. As per the scheme guidelines, surveillance assessment ', @r, N' of your certificate is due by <b>',
                            FORMAT(@due, 'MMM dd yyyy'), N'</b>.</p><p>The surveillance assessment is mandatory for continuation of the certification. ',
                            CASE WHEN @AutoApply = 1 THEN N'If you do not apply, the portal will apply for it on your behalf.'
                                 ELSE N'Failure to do so will lead to suspension/withdrawal of the certification.' END,
                            N'</p><p>Please sign in to the ZED portal with your ZED ID <b>',
                            @ZedId, N'</b> and apply for the surveillance assessment from your dashboard.</p><p>Unit: ', @Unit, N'</p><p>Thanks and Regards,<br>ZED Team</p>');
                        INSERT INTO dbo.SurveillanceAutoMailHistory (ZedId, Certification, CertificationStatusDate, CreatedDate, RecipientEmail, UnitName, MailNumber, MailType, SurveillanceNo)
                        VALUES (@ZedId, @Cert, @CertDate, @now, @Email, @Unit, 1, 'APPLY', @r);
                    END
                END
                ELSE IF @step = 2
                BEGIN
                    UPDATE dbo.MsmeCertifications SET AutoMailSend = (@r - 1) * 10 + 1 + @k WHERE ZedId = @ZedId AND Certification = @Cert;
                    IF @silent = 0
                    BEGIN
                        SET @subject = CONCAT(N'Reminder ', @k, N': Apply for Surveillance Assessment under ', @Scheme, N' - ', @ZedId);
                        SET @body = CONCAT(N'<p>Dear Madam/Sir,<br>Greetings of the day!</p><p>This is a reminder that surveillance assessment ', @r,
                            N' of your ', @Name, N' certification is due by <b>', FORMAT(@due, 'MMM dd yyyy'),
                            N'</b>. Please sign in to the ZED portal with your ZED ID <b>', @ZedId, N'</b> and apply for it from your dashboard. ',
                            CASE WHEN @AutoApply = 1 THEN N'If you do not apply, the portal will apply for it on your behalf.'
                                 ELSE N'Failure to do so will lead to suspension/withdrawal of the certification.' END,
                            N'</p><p>Thanks and Regards,<br>ZED Team</p>');
                        INSERT INTO dbo.SurveillanceAutoMailHistory (ZedId, Certification, CertificationStatusDate, CreatedDate, RecipientEmail, UnitName, MailNumber, MailType, SurveillanceNo)
                        VALUES (@ZedId, @Cert, @CertDate, @now, @Email, @Unit, @k + 1, 'REMINDER', @r);
                    END
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
                    -- As the legacy withdrawal of Silver / Gold: the unit may apply again (re-certification).
                    IF @Legacy = 1 AND OBJECT_ID('dbo.SP_JOB_ENABLE_FOR_RE_CERTIFICATION', 'P') IS NOT NULL
                        EXEC dbo.SP_JOB_ENABLE_FOR_RE_CERTIFICATION @ZedId, @Cert, 'ReCertification Enabled due to Certificate Withdrawal';
                    SET @subject = CONCAT(N'Withdrawal of Certification under ', @Scheme, N' - ', @ZedId);
                    SET @body = CONCAT(N'<p>Dear Madam/Sir,<br>Greetings of the day!</p><p>Surveillance assessment ', @r, N' of your ', @Name,
                        N' certification has not been completed after the suspension. Your certification is therefore <b>withdrawn</b>.</p>',
                        N'<p>Thanks and Regards,<br>ZED Team</p>');
                    INSERT INTO dbo.SurveillanceAutoMailHistory (ZedId, Certification, CertificationStatusDate, CreatedDate, RecipientEmail, UnitName, MailNumber, MailType, SurveillanceNo)
                    VALUES (@ZedId, @Cert, @CertDate, @now, @Email, @Unit, 1, CASE WHEN @Legacy = 1 THEN 'WITHDRAWN' ELSE 'WITHDRAWAL' END, @r);
                END
                ELSE IF @step = 5
                BEGIN
                    -- As the legacy Bronze job: the unit is applied for its surveillance (the zero / coupon fee row of its category);
                    -- not when its day was before the level's start (only counted, so that the steps after it still come).
                    IF @silent = 0 AND NOT EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.dbo.MsmeCertifications S WHERE S.ZedId = @ZedId AND S.Certification = @Cert)
                    BEGIN
                        BEGIN TRY
                            EXEC ZED_SURVEILLANCE.dbo.SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND @ZedId = @ZedId, @Certification = @Cert;
                        END TRY
                        BEGIN CATCH
                            -- The legacy procedure mails through msdb itself; without Database Mail (SQL Express before 0003)
                            -- that fails after the unit was applied. Only a failure that leaves no surveillance record counts.
                            IF XACT_STATE() = -1 THROW;
                            PRINT CONCAT('Bronze surveillance of ', @ZedId, ' applied with a message: ', ERROR_MESSAGE());
                        END CATCH
                        IF NOT EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.dbo.MsmeCertifications S WHERE S.ZedId = @ZedId AND S.Certification = @Cert)
                            THROW 50001, 'The surveillance could not be applied for (no record in ZED_SURVEILLANCE).', 1;
                    END
                    UPDATE dbo.MsmeCertifications SET AutoMailSend = (@r - 1) * 10 + 1 + @k WHERE ZedId = @ZedId AND Certification = @Cert;
                    IF @silent = 0
                        INSERT INTO dbo.SurveillanceAutoMailHistory (ZedId, Certification, CertificationStatusDate, CreatedDate, RecipientEmail, UnitName, MailNumber, MailType, SurveillanceNo)
                        VALUES (@ZedId, @Cert, @CertDate, @now, @Email, @Unit, @k + 1, 'Auto-Applied', @r);
                END
                INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
                VALUES (@ZedId, CONCAT(CASE @step WHEN 1 THEN N'Surveillance ' + CAST(@r AS nvarchar(3)) + N' opened, due ' + FORMAT(@due, 'MMMM d, yyyy')
                                                  WHEN 2 THEN N'Surveillance ' + CAST(@r AS nvarchar(3)) + N' reminder ' + CAST(@k AS nvarchar(3))
                                                  WHEN 3 THEN N'Suspended: surveillance ' + CAST(@r AS nvarchar(3)) + N' not applied for'
                                                  WHEN 5 THEN CASE WHEN @silent = 1 THEN N'Not applied for surveillance ' ELSE N'Applied for surveillance ' END
                                                              + CAST(@r AS nvarchar(3)) + N' by the portal'
                                                  ELSE N'Withdrawn: surveillance ' + CAST(@r AS nvarchar(3)) + N' not completed' END, N' on ', FORMAT(@now, 'MMMM d, yyyy'),
                                           CASE WHEN @silent = 1 THEN N' (no mail: its day, ' + FORMAT(@stepDate, 'MMMM d, yyyy') + N', was before the V4 schedule started)' END),
                        @now, @Cert, CASE @step WHEN 1 THEN 'SurveillanceOpened' WHEN 2 THEN 'SurveillanceReminder' WHEN 3 THEN 'Suspended'
                                                WHEN 5 THEN CASE WHEN @silent = 1 THEN 'SurveillanceNotAutoApplied' ELSE 'SurveillanceAutoApplied' END ELSE 'Withdrawn' END);
                COMMIT;
                IF @subject IS NOT NULL EXEC dbo.SP_V4_SURVEILLANCE_MAIL @To = @Email, @Subject = @subject, @Body = @body;
            END TRY
            BEGIN CATCH
                IF @@TRANCOUNT > 0 ROLLBACK;
                PRINT CONCAT('Surveillance schedule of ', @ZedId, ' ', @Cert, ' failed: ', ERROR_MESSAGE());
                SET @failed = 1;
            END CATCH

            IF @silent = 0 OR @failed = 1 BREAK;
            -- Moved on without its mail (a dry run only as if): the unit as it is now, then its next step.
            IF @step = 1
                SELECT @Round = @r, @Mail = (@r - 1) * 10 + 1, @Paid = CASE WHEN @r > 1 THEN 0 ELSE @Paid END;
            ELSE
                SET @Mail = (@r - 1) * 10 + 1 + @k;
        END

        FETCH NEXT FROM w INTO @ZedId, @Cert, @CertDate, @Phase, @Mail, @Round, @Email, @Unit, @Paid, @Name, @First, @Cnt, @Interval, @Notice, @Rem,
            @RemEvery, @Suspend, @Withdraw, @AutoApply, @SuspendRounds, @StartFrom, @Legacy, @Desk;
    END
    CLOSE w; DEALLOCATE w;

    IF @DryRun = 1
        SELECT ZedId, Certification, Round, Step, StepDate, Due, Note FROM @Plan ORDER BY Certification, Step, StepDate, ZedId;
END
GO
