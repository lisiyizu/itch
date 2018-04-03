import * as React from "react";
import { connect, actionCreatorsList, Dispatchers } from "./connect";
import { createStructuredSelector } from "reselect";

import Button from "./basics/button";
import RowButton, { Tag } from "./basics/row-button";
import IconButton from "./basics/icon-button";
import Icon from "./basics/icon";
import Markdown from "./basics/markdown";
import Filler from "./basics/filler";
import TimeAgo from "./basics/time-ago";
import Cover from "./basics/cover";
import Hoverable from "./basics/hover-hoc";
const HoverCover = Hoverable(Cover);

import * as colors from "../constants/colors";

import { actions } from "../actions";
import { map, isEmpty, filter } from "underscore";

import { IModal, IModalButtonSpec, IModalButton, IAction } from "../types";

import watching, { Watcher } from "./watching";
import styled, * as styles from "./styles";
import { stripUnit } from "polished";

import format, { formatString } from "./format";
import { InjectedIntl, injectIntl } from "react-intl";
import { specToButton } from "../helpers/spec-to-button";
import { modalWidgets } from "./modal-widgets/index";
import classNames = require("classnames");

type Flavor = "normal" | "big";

const ModalPortalDiv = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(7, 4, 4, 0.74);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 200;
  animation: ${styles.animations.fadeIn} 0.2s;

  .content {
    min-width: 50%;
    max-width: 90%;
    max-height: 80%;
    overflow-y: auto;

    &.fullscreen {
      min-width: 100%;
      max-width: 100%;
      min-height: 100%;
      max-height: 100%;
      position: relative;

      .modal-div {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        right: 0;
      }
    }

    padding: 0px;
    background-color: ${colors.darkMineShaft};
    border: 1px solid ${colors.lightMineShaft};
    border-radius: 2px;
    box-shadow: 0 0 32px black;
    z-index: 200;
  }
`;

const ModalDiv = styled.div`
  min-width: 200px;
  min-height: 200px;

  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow-y: auto;

  .big-wrapper {
    display: flex;
    flex-direction: row;

    .cover-container,
    .cover {
      width: 230px;
      margin-bottom: 20px;
    }

    .cover-container {
      flex: 1 0;
      align-self: flex-start;
      margin-left: 20px;
      margin-top: 20px;
    }

    .buttons {
      flex-grow: 1;
    }
  }

  .body {
    margin-top: 20px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: stretch;
    line-height: 1.6;

    ul {
      list-style-type: disc;
      margin-bottom: 1.5em;

      li {
        margin-left: 1.5em;
      }
    }

    .message {
      padding: 0 20px;
      overflow-y: auto;
      max-height: 460px;
      -webkit-user-select: initial;

      h1,
      h2,
      h3,
      h4,
      h5,
      h6 {
        margin-bottom: 0.4em;
        font-size: ${props => stripUnit(props.theme.fontSizes.baseText) + 2}px;
        font-weight: bold;
      }

      a {
        color: darken($ivory, 5%);

        &:hover {
          color: $ivory;
          cursor: pointer;
        }
      }

      p img {
        max-width: 100%;
      }

      code {
        font-family: monospace;
      }

      .secondary {
        color: ${props => props.theme.secondaryText};
      }

      strong {
        font-weight: bold;
      }
    }

    p {
      line-height: 1.4;
      margin: 8px 0;
    }

    .icon {
      margin-top: 8px;
      margin-right: 12px;
      font-size: 48px;
    }
  }

  .modal-widget {
    padding: 10px 20px;
    flex-grow: 1;

    input[type="number"],
    input[type="text"],
    input[type="password"] {
      @include heavy-input;
      width: 100%;
    }

    input[type="number"] {
      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
    }

    strong {
      font-weight: bold;
    }

    p {
      line-height: 1.4;
      margin: 8px 0;
    }

    .json-tree-container {
      width: 100%;
      height: 350px;
      overflow-y: auto;
    }

    .prereqs-rows {
      display: flex;
      flex: 0 1;
      flex-direction: column;
      align-content: flex-start;
    }

    .prereqs-row {
      display: flex;
      flex: 0 1;
      flex-direction: row;
      align-items: center;
      margin: 14px 0;
      margin-left: 10px;

      .task-status {
        margin-top: 5px;
        font-size: 80%;
        color: $secondary-text-color;
      }
    }

    .clear-browsing-data-list {
      label {
        display: block;
        border-left: 3px solid $pref-border-color;
        padding: 5px 0;
        padding-left: 5px;
        margin: 3px 0;
        margin-bottom: 10px;
        transition: 0.2s border ease-in-out;

        &:hover {
          cursor: pointer;
        }

        &.active {
          border-color: $accent-color;
        }
      }

      .checkbox {
        margin: 0;
        display: flex;
        align-items: center;

        input[type="checkbox"] {
          margin-right: 10px;
        }
      }

      .checkbox-info {
        margin: 0;
        margin-top: 5px;
        margin-left: 5px;
        font-size: 90%;
        color: $secondary-text-color;
      }
    }
  }

  .buttons {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 20px;

    &.flavor-big {
      flex-direction: column;
      align-items: stretch;
      padding: 8px 20px;
      max-height: 300px;
      overflow-y: auto;

      .button {
        transition: -webkit-filter 0.2s;
        font-weight: bold;
        text-shadow: 0 0 2px rgba(0, 0, 0, 0.58);

        &:not(.action-play) {
          -webkit-filter: grayscale(100%) brightness(70%);
        }

        &:hover {
          -webkit-filter: brightness(110%);
        }

        &,
        &.secondary {
          display: flex;
          align-items: center;
          margin: 8px 0;
          font-size: 16px;
          padding: 14px 14px;
        }

        .tag {
          margin: 0 0 0 7px;
          font-size: 80%;
          padding: 5px 4px;
          border-radius: 4px;
          background: #fffff0;
          color: $button-background-color;
          text-shadow: none;
        }

        .icon {
          margin-right: 10px;
        }
      }
    }
  }
`;

const BigButtonContent = styled.div`
  flex: 1 1;
  display: flex;
  flex-direction: column;
`;

const BigButtonRow = styled.div`
  display: flex;
  flex-direction: row;
  margin: 0.3em 0.1em;
`;

const HeaderDiv = styled.div`
  background: ${props => props.theme.sidebarBackground};
  padding: 8px;
  padding-left: 20px;
  display: flex;
  flex-direction: row;
  align-items: center;

  min-height: 2.6em;

  .title {
    color: ${props => props.theme.secondaryText};
    font-size: ${props => props.theme.fontSizes.large};
  }
`;

const ButtonsDiv = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 20px;

  & > * {
    margin-left: 8px;
  }
`;

const BigButtonsDiv = styled.div`
  display: flex;
  flex-direction: column;
  padding: 20px;
  width: 100%;
  justify-content: stretch;

  & > * {
    margin-bottom: 12px;
  }
`;

@watching
class Modal extends React.PureComponent<IProps & IDerivedProps, IState> {
  constructor(props: Modal["props"], context) {
    super(props, context);
    this.state = {
      widgetPayload: null,
    };
  }

  subscribe(watcher: Watcher) {
    watcher.on(actions.commandOk, async (store, action) => {
      const { modal } = this.props;
      if (!modal) {
        return;
      }

      if (modal.bigButtons && !isEmpty(modal.bigButtons)) {
        // 'ok' does nothing when there's big buttons
        return;
      }

      if (modal.buttons && !isEmpty(modal.buttons)) {
        let primaryButtons = map(modal.buttons, specToButton);
        primaryButtons = filter(
          primaryButtons,
          b => !/secondary/.test(b.className)
        );
        // if there's more than one primary button, or none at all, 'ok' does nothing
        if (primaryButtons.length === 1) {
          const onClick = this.buttonOnClick(primaryButtons[0]);
          onClick();
        }
      }
    });
  }

  render() {
    const { modal } = this.props;
    if (!modal) {
      return null;
    }

    return (
      <ModalPortalDiv>
        <div
          className={classNames("content", { fullscreen: modal.fullscreen })}
        >
          {this.renderContent()}
        </div>
      </ModalPortalDiv>
    );
  }

  renderContent() {
    const { modal, closeModal, intl } = this.props;

    if (!modal) {
      return null;
    }

    const {
      bigButtons = [],
      buttons = [],
      title = "",
      message = "",
      detail,
      widget,
    } = modal;
    return (
      <ModalDiv className="modal-div">
        <HeaderDiv>
          <span className="title" onClick={this.onDebugClick}>
            {format(title)}
          </span>
          <Filler />
          {modal.unclosable ? null : (
            <IconButton icon="cross" onClick={() => closeModal({})} />
          )}
        </HeaderDiv>

        {message !== "" ? (
          <div className="body">
            <div className="message">
              <div>
                <Markdown source={formatString(intl, message)} />
              </div>
              {detail && (
                <div className="secondary">
                  <Markdown source={formatString(intl, detail)} />
                </div>
              )}
            </div>
          </div>
        ) : null}

        {bigButtons.length > 0 ? (
          <div className="big-wrapper">
            {this.renderCover(modal)}
            {this.renderButtons(bigButtons, "big")}
          </div>
        ) : null}

        {widget ? this.renderWidget(widget, modal) : null}

        {this.renderButtons(buttons, "normal")}
      </ModalDiv>
    );
  }

  onDebugClick = (e: React.MouseEvent<any>) => {
    if (e.shiftKey && e.ctrlKey) {
      const { openModal } = this.props;
      openModal(
        modalWidgets.exploreJson.make({
          title: "Modal payload",
          message: "",
          widgetParams: {
            data: this.props.modal,
          },
          fullscreen: true,
        })
      );
      return;
    }
  };

  renderCover(modal: IModal): JSX.Element {
    const { coverUrl, stillCoverUrl } = modal;

    if (!(stillCoverUrl || coverUrl)) {
      return null;
    }

    return (
      <div className="cover-container">
        <HoverCover
          gameId={0}
          className="cover"
          coverUrl={coverUrl}
          stillCoverUrl={stillCoverUrl}
        />
      </div>
    );
  }

  renderButtons(buttons: IModalButtonSpec[], flavor: Flavor) {
    if (buttons.length === 0) {
      return null;
    }

    switch (flavor) {
      case "big":
        return this.renderBigButtons(buttons);
      case "normal":
        return this.renderNormalButtons(buttons);
      default:
        return <div>?</div>;
    }
  }

  renderBigButtons(buttons: IModalButtonSpec[]) {
    return (
      <BigButtonsDiv>
        {map(buttons, (buttonSpec, index) => {
          const button = specToButton(buttonSpec);
          const { label, className = "", icon, id, tags, timeAgo } = button;
          let onClick = this.buttonOnClick(button);

          return (
            <RowButton
              id={id}
              ink={false}
              className={className}
              key={index}
              icon={icon}
              onClick={onClick}
            >
              <BigButtonContent>
                <BigButtonRow>{format(label)}</BigButtonRow>

                {tags || timeAgo ? (
                  <BigButtonRow>
                    {tags
                      ? map(tags, tag => {
                          return (
                            <Tag>
                              {tag.icon ? <Icon icon={tag.icon} /> : null}
                              {tag.label ? format(tag.label) : null}
                            </Tag>
                          );
                        })
                      : null}
                    {timeAgo ? (
                      <Tag>
                        <TimeAgo date={timeAgo.date} />
                      </Tag>
                    ) : null}
                  </BigButtonRow>
                ) : null}
              </BigButtonContent>
            </RowButton>
          );
        })}
      </BigButtonsDiv>
    );
  }

  renderNormalButtons(buttons: IModalButtonSpec[]) {
    return (
      <ButtonsDiv>
        <Filler />
        {map(buttons, (buttonSpec, index) => {
          const button = specToButton(buttonSpec);
          const { label, className = "", icon, id } = button;
          let onClick = this.buttonOnClick(button);

          return (
            <Button
              id={id}
              primary={className !== "secondary"}
              discreet
              key={index}
              onClick={onClick}
              icon={icon}
              label={format(label)}
            />
          );
        })}
      </ButtonsDiv>
    );
  }

  buttonOnClick(button: IModalButton): () => void {
    const { closeModal } = this.props;
    const { action } = button;

    let onClick: () => void;
    if (action === "widgetResponse") {
      onClick = () => {
        const action = actions.modalResponse(this.state.widgetPayload);
        closeModal({ action });
      };
    } else {
      onClick = () => closeModal({ action: action as IAction<any> });
    }
    return onClick;
  }

  renderWidget(widget: string, modal: IModal): JSX.Element {
    const Component = modalWidgets[widget].component;
    if (!Component) {
      return null;
    }
    return <Component modal={modal} updatePayload={this.updatePayload} />;
  }

  updatePayload = (payload: typeof actions.modalResponse.payload) => {
    this.setState({ widgetPayload: payload });
  };
}

interface IProps {}

const actionCreators = actionCreatorsList("openModal", "closeModal");

type IDerivedProps = Dispatchers<typeof actionCreators> & {
  modal: IModal;

  intl: InjectedIntl;
};

interface IState {
  widgetPayload?: typeof actions.modalResponse.payload;
}

export default connect<IProps>(injectIntl(Modal), {
  state: createStructuredSelector({
    modal: state => state.modals[0],
  }),
  actionCreators,
});
