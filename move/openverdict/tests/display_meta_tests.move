#[test_only]
module openverdict::display_meta_tests {
    use openverdict::agent_registry::AgentProfile;
    use openverdict::demo_binary_pool::Position;
    use openverdict::display_meta;
    use openverdict::jury::ResolutionCertificate;
    use std::string::String;
    use sui::display::{Self, Display};
    use sui::package::{Self, Publisher};
    use sui::sui::SUI;
    use sui::test_scenario;
    use sui::vec_map;

    const PUBLISHER: address = @0xA11CE;

    #[test]
    fun init_claims_publisher_and_configures_all_displays() {
        let mut scenario = test_scenario::begin(PUBLISHER);
        display_meta::init_for_testing(scenario.ctx());

        test_scenario::next_tx(&mut scenario, PUBLISHER);
        assert!(test_scenario::has_most_recent_for_sender<Publisher>(&scenario));
        assert!(
            test_scenario::has_most_recent_for_sender<Display<ResolutionCertificate>>(&scenario),
        );
        assert!(test_scenario::has_most_recent_for_sender<Display<AgentProfile>>(&scenario));
        assert!(test_scenario::has_most_recent_for_sender<Display<Position<SUI>>>(&scenario));

        let publisher = test_scenario::take_from_sender<Publisher>(&scenario);
        let certificate = test_scenario::take_from_sender<Display<ResolutionCertificate>>(&scenario);
        let agent = test_scenario::take_from_sender<Display<AgentProfile>>(&scenario);
        let position = test_scenario::take_from_sender<Display<Position<SUI>>>(&scenario);

        assert!(package::from_package<ResolutionCertificate>(&publisher));
        assert!(display::version(&certificate) == 1);
        assert!(vec_map::size(display::fields(&certificate)) == 4);
        assert_field(
            &certificate,
            b"name".to_string(),
            b"OpenVerdict Resolution Certificate".to_string(),
        );
        assert_field(
            &certificate,
            b"description".to_string(),
            b"Final rule-bound verdict for claim {claim_id} - result code {result}, truth score {truth_score_bps} bps".to_string(),
        );
        assert_field(
            &certificate,
            b"link".to_string(),
            b"https://github.com/Marcussy34/OpenVerdict".to_string(),
        );
        assert_field(
            &certificate,
            b"project_url".to_string(),
            b"https://github.com/Marcussy34/OpenVerdict".to_string(),
        );

        assert!(display::version(&agent) == 1);
        assert!(vec_map::size(display::fields(&agent)) == 2);
        assert_field(&agent, b"name".to_string(), b"OpenVerdict Jury Agent".to_string());
        assert_field(
            &agent,
            b"description".to_string(),
            b"Human-backed AI oracle agent - active: {active}".to_string(),
        );

        assert!(display::version(&position) == 1);
        assert!(vec_map::size(display::fields(&position)) == 2);
        assert_field(&position, b"name".to_string(), b"OpenVerdict Demo Position".to_string());
        assert_field(
            &position,
            b"description".to_string(),
            b"Capped demo prediction-market position for claim-linked pool".to_string(),
        );

        test_scenario::return_to_sender(&scenario, publisher);
        test_scenario::return_to_sender(&scenario, certificate);
        test_scenario::return_to_sender(&scenario, agent);
        test_scenario::return_to_sender(&scenario, position);
        scenario.end();
    }

    /// Verify both the display key and its exact template value.
    fun assert_field<T: key>(metadata: &Display<T>, name: String, expected: String) {
        let fields = display::fields(metadata);
        assert!(vec_map::contains(fields, &name));
        assert!(*vec_map::get(fields, &name) == expected);
    }
}
